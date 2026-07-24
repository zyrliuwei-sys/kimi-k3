import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { envConfigs } from '@/config';
import {
  addDocument,
  bulkDeleteDocuments,
  deleteDocument,
  getCollection,
  getDocument,
  listDocuments,
  parseAndStoreDocument,
} from '@/modules/doc-library/service';
import { getStorage } from '@/modules/storage/service';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';

/**
 * /api/doc-library/document
 *
 *   GET    ?collectionId=… — list docs in a collection
 *   POST   (multipart)     — upload one or more files, parses inline
 *   DELETE ?id=…          — remove a single document
 *   DELETE (body: { ids: [...] }) — bulk delete
 *
 * File upload accepts the same MIME set as /api/storage/upload-media (PDF,
 * Word, Excel, PPTX, plain text, CSV). The endpoint immediately parses
 * uploaded files inline so the user can start asking questions right away.
 * For very large files (>5MB) parsing runs synchronously in the request;
 * V2 should move this to a background job.
 */

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB per file — same cap as the
// playground chat attachment upload.

const ALLOWED_MIME = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
]);

const ALLOWED_EXTS = new Set<string>([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'md',
  'csv',
]);

const extFromMime: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
};

const md5 = async (buf: Buffer) => {
  const { createHash } = await import('node:crypto');
  return createHash('md5').update(buf).digest('hex');
};

function isLocalFallbackAvailable(): boolean {
  const cwd = process.cwd();
  if (
    cwd === '/var/task' ||
    cwd.startsWith('/var/task/') ||
    cwd.startsWith('/opt/') ||
    cwd === '/workspace'
  )
    return false;
  if (process.env.DISABLE_LOCAL_UPLOAD_FALLBACK === 'true') return false;
  return true;
}

async function requireUser() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: new Headers() });
  if (!session?.user?.id) {
    return { error: respErr('Unauthorized', { status: 401 }) } as const;
  }
  return { userId: session.user.id } as const;
}

export const Route = createFileRoute('/api/doc-library/document')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const r = await requireUser();
        if ('error' in r) return r.error;
        const url = new URL(request.url);
        const collectionId = url.searchParams.get('collectionId') || '';
        if (!collectionId) {
          return respErr('collectionId is required', { status: 400 });
        }
        const rows = await listDocuments(r.userId, collectionId);
        return respData(rows);
      },

      POST: async ({ request }) => {
        const r = await requireUser();
        if ('error' in r) return r.error;

        // Per-IP rate limit (matches the playground chat upload cadence).
        const limited = enforceMinIntervalRateLimit(request, {
          intervalMs: 1000,
          keyPrefix: 'doc-library-upload',
        });
        if (limited) return limited;

        const ct = request.headers.get('content-type') || '';
        if (!ct.startsWith('multipart/form-data')) {
          return respErr('Expected multipart/form-data', { status: 400 });
        }

        const form = await request.formData();
        const collectionId = (form.get('collectionId') as string) || '';
        if (!collectionId) {
          return respErr('collectionId is required', { status: 400 });
        }
        // Ownership re-check (defense in depth — also enforced in service).
        const owner = await getCollection(r.userId, collectionId);
        if (!owner) {
          return respErr('Collection not found', { status: 404 });
        }

        const files = form
          .getAll('files')
          .filter((f): f is File => f instanceof File);
        if (!files.length) return respErr('No files uploaded', { status: 400 });
        if (files.length > 50) {
          return respErr('Up to 50 files at a time', { status: 400 });
        }

        const storage = await getStorage();
        const results: any[] = [];

        for (const file of files) {
          const buf = Buffer.from(await file.arrayBuffer());

          // Pre-flight: size + type
          if (buf.length > MAX_BYTES) {
            results.push({
              filename: file.name,
              ok: false,
              error: `File too large (max ${MAX_BYTES / 1024 / 1024}MB)`,
            });
            continue;
          }
          const mime = file.type || 'application/octet-stream';
          const ext = (file.name.split('.').pop() || '').toLowerCase();
          if (!ALLOWED_MIME.has(mime) && !ALLOWED_EXTS.has(ext)) {
            results.push({
              filename: file.name,
              ok: false,
              error: `Unsupported file type (${mime || ext || 'unknown'})`,
            });
            continue;
          }

          // Persist the raw file first so the URL is durable even if parse
          // fails — the user can retry parsing later.
          let storageUrl = '';
          let storageKey = '';
          if (storage) {
            const key = `doc-library/${collectionId}/${Date.now()}-${await md5(buf)}.${extFromMime[mime] || ext || 'bin'}`;
            try {
              const fileObj = {
                buffer: buf,
                key,
                contentType: mime,
              } as any;
              const out: any = await storage.upload(fileObj);
              storageUrl = out?.url || '';
              storageKey = key;
            } catch (e: any) {
              results.push({
                filename: file.name,
                ok: false,
                error: `Storage upload failed: ${e?.message || 'unknown'}`,
              });
              continue;
            }
          } else if (isLocalFallbackAvailable()) {
            const key = `doc-library/${collectionId}/${Date.now()}-${await md5(buf)}.${extFromMime[mime] || ext || 'bin'}`;
            const uploadPath = path.join(
              process.cwd(),
              'public',
              'uploads',
              key
            );
            await mkdir(path.dirname(uploadPath), { recursive: true });
            await writeFile(uploadPath, buf);
            storageUrl = `${envConfigs.app_url || ''}/uploads/${key}`;
            storageKey = key;
          } else {
            results.push({
              filename: file.name,
              ok: false,
              error: 'Storage not configured',
            });
            continue;
          }

          // Record the doc row, then parse inline.
          const doc = await addDocument({
            userId: r.userId,
            input: {
              collectionId,
              filename: file.name,
              storageUrl,
              storageKey,
              mimeType: mime,
              fileBytes: buf.length,
            },
          });

          let parseStatus: string = doc.parseStatus;
          let parseError: string | null = null;
          let pageCount = 0;
          try {
            await parseAndStoreDocument({ userId: r.userId, docId: doc.id });
            const fresh = await getDocument(r.userId, doc.id);
            parseStatus = fresh?.parseStatus || 'success';
            pageCount = fresh?.pageCount || 0;
          } catch (e: any) {
            parseStatus = 'failed';
            parseError = e?.message || 'Parse failed';
          }

          results.push({
            filename: file.name,
            ok: parseStatus !== 'failed',
            id: doc.id,
            parseStatus,
            parseError,
            pageCount,
            fileBytes: buf.length,
          });
        }

        return respData({ results });
      },

      DELETE: async ({ request }) => {
        const r = await requireUser();
        if ('error' in r) return r.error;

        // Two delete shapes: single (?id=…) or bulk (body { ids: [...] }).
        const url = new URL(request.url);
        const singleId = url.searchParams.get('id');
        if (singleId) {
          const ok = await deleteDocument(r.userId, singleId);
          if (!ok) return respErr('Document not found', { status: 404 });
          return respData({ id: singleId });
        }

        const body = (await request.json().catch(() => ({}))) as {
          ids?: string[];
        };
        if (!Array.isArray(body.ids) || body.ids.length === 0) {
          return respErr('id (query) or ids (body) is required', {
            status: 400,
          });
        }
        if (body.ids.length > 100) {
          return respErr('Up to 100 ids per bulk delete', { status: 400 });
        }
        const removed = await bulkDeleteDocuments(r.userId, body.ids);
        return respData({ removed });
      },
    },
  },
});
