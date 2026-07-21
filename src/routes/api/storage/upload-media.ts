import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { envConfigs } from '@/config';
import { getStorage } from '@/modules/storage/service';
import { md5 } from '@/lib/hash';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';

/**
 * Chat attachment upload — accepts images AND short videos. Used by the API
 * Playground "+" button. Mirrors `upload-image.ts` (which support tickets also
 * rely on) but widens the accepted MIME set so the chat composer can attach
 * video too. Auth-required (aligns with the freemium model — anonymous chat
 * stays text-only). Images are sent on to a vision model; videos are
 * display-only.
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
  };
  return map[mimeType] || '';
};

const isImage = (t: string) => t.startsWith('image/');
const isVideo = (t: string) => t.startsWith('video/');

// Cap for the no-storage local-disk fallback (dev). Configurable via
// INLINE_IMAGE_MAX_KB (shared with upload-image so the dev ceiling is uniform).
const INLINE_MAX_BYTES =
  (Number(envConfigs.inline_image_max_kb) || 10240) * 1024;

async function POST({ request }: { request: Request }) {
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: 1000,
    keyPrefix: 'upload-media',
  });
  if (limited) return limited;

  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized');

    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    if (!files.length) return respErr('No files provided');

    const storage = await getStorage();
    const uploadResults: Array<{
      url: string;
      key: string;
      filename: string;
      type: 'image' | 'video';
      deduped: boolean;
    }> = [];

    for (const file of files) {
      if (!isImage(file.type) && !isVideo(file.type)) {
        return respErr(
          `File ${file.name} is not an image or video (got ${file.type || 'unknown'})`
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const body = new Uint8Array(arrayBuffer);

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
          type: isImage(file.type) ? 'image' : 'video',
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
            type: isImage(file.type) ? 'image' : 'video',
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
        type: isImage(file.type) ? 'image' : 'video',
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
