import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { envConfigs } from '@/config';
import { getStorage } from '@/modules/storage/service';
import { md5 } from '@/lib/hash';
import { checkIpQuota, enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';

/**
 * Chat attachment upload — accepts images AND short videos. Used by the API
 * Playground "+" button. Mirrors `upload-image.ts` (which support tickets also
 * rely on) but widens the accepted MIME set so the chat composer can attach
 * video too. Anonymous uploads are allowed (so the screenshot-clone flow works
 * without sign-in) but capped per IP; the chat endpoint's "1 free message per
 * IP" gate remains the real AI-cost ceiling. Images are sent on to a vision
 * model; videos are display-only.
 */

const extFromMime = (mimeType: string) => {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov',
    // Documents
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      'pptx',
  };
  return map[mimeType] || '';
};

const isImage = (t: string) => t.startsWith('image/');
const isVideo = (t: string) => t.startsWith('video/');
const DOCUMENT_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const isDocument = (t: string) => DOCUMENT_MIMES.has(t);

// Cap for the no-storage local-disk fallback (dev). Configurable via
// INLINE_IMAGE_MAX_KB (shared with upload-image so the dev ceiling is uniform).
const INLINE_MAX_BYTES =
  (Number(envConfigs.inline_image_max_kb) || 204800) * 1024;

// Abuse guardrails for the now-anonymous playground upload path. The chat
// endpoint's "1 free message per IP" gate remains the real AI-cost ceiling;
// these just bound storage/Disk exposure. Per-IP quota relies on the
// unspoofable CF-Connecting-IP resolved by getClientIpFromRequest.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB per file
const MAX_FILES = 50; // per request
const ANON_UPLOAD_LIMIT = 1; // free anonymous uploads per IP

async function POST({ request }: { request: Request }) {
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: 1000,
    keyPrefix: 'upload-media',
  });
  if (limited) return limited;

  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });

    // Anonymous uploads are allowed (so the playground's screenshot-clone flow
    // works without sign-in) but capped per IP; signed-in users skip the quota.
    if (!session?.user) {
      const quota = checkIpQuota(request, {
        keyPrefix: 'playground-anon-upload',
        limit: ANON_UPLOAD_LIMIT,
      });
      if (quota.exceeded) {
        return respErr(
          'Anonymous upload limit reached — please sign in to upload more.',
          { status: 429 }
        );
      }
    }

    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    if (!files.length) return respErr('No files provided');
    if (files.length > MAX_FILES) {
      return respErr('Too many files (max 50).', { status: 413 });
    }

    const storage = await getStorage();
    const uploadResults: Array<{
      url: string;
      key: string;
      filename: string;
      type: 'image' | 'video' | 'document';
      deduped: boolean;
    }> = [];

    for (const file of files) {
      if (
        !isImage(file.type) &&
        !isVideo(file.type) &&
        !isDocument(file.type)
      ) {
        return respErr(
          `File ${file.name} is not a supported image, video, or document (got ${file.type || 'unknown'})`
        );
      }

      const fileKind: 'image' | 'video' | 'document' = isImage(file.type)
        ? 'image'
        : isVideo(file.type)
          ? 'video'
          : 'document';

      const arrayBuffer = await file.arrayBuffer();
      const body = new Uint8Array(arrayBuffer);

      if (body.length > MAX_UPLOAD_BYTES) {
        return respErr(
          `File ${file.name} is too large (max ${Math.round(
            MAX_UPLOAD_BYTES / 1024 / 1024
          )}MB).`,
          { status: 413 }
        );
      }

      const digest = md5(body);
      const ext =
        (extFromMime(file.type) || file.name.split('.').pop() || 'bin').replace(
          /[^a-zA-Z0-9]/g,
          ''
        ) || 'bin';
      const objectKey = `${digest}.${ext}`;

      // No storage configured → persist to public/uploads and return a short
      // local URL (R2Provider prepends its own uploadPath otherwise). Configure
      // R2 (admin → Storage) for production.
      if (!storage) {
        if (body.length > INLINE_MAX_BYTES) {
          const limitKb = Math.round(INLINE_MAX_BYTES / 1024);
          return respErr(
            `File too large (${(body.length / 1024).toFixed(0)}KB > ${limitKb}KB). Configure storage or use a smaller file.`
          );
        }
        const dir = path.join(process.cwd(), 'public', 'uploads');
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, objectKey), body);
        uploadResults.push({
          url: `/uploads/${objectKey}`,
          key: `uploads/${objectKey}`,
          filename: file.name,
          type: fileKind,
          deduped: false,
        });
        continue;
      }

      const exists = await storage.exists({ key: objectKey });
      if (exists) {
        const publicUrl = storage.getPublicUrl({ key: objectKey });
        if (publicUrl) {
          uploadResults.push({
            url: publicUrl,
            key: objectKey,
            filename: file.name,
            type: fileKind,
            deduped: true,
          });
          continue;
        }
      }

      const result = await storage.uploadFile({
        body,
        key: objectKey,
        contentType: file.type,
        disposition: 'inline',
      });

      if (!result.success || !result.url) {
        return respErr(result.error || 'Upload failed');
      }

      uploadResults.push({
        url: result.url,
        key: result.key || objectKey,
        filename: file.name,
        type: fileKind,
        deduped: false,
      });
    }

    return respData({
      urls: uploadResults.map((r) => r.url),
      results: uploadResults,
    });
  } catch (e: any) {
    console.error('upload media failed:', e);
    return respErr(e?.message || 'upload media failed');
  }
}

export const Route = createFileRoute('/api/storage/upload-media')({
  server: {
    handlers: { POST },
  },
});
