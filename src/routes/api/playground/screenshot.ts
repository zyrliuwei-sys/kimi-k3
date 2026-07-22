import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { getScreenshot } from '@/core/screenshot';
import { envConfigs } from '@/config';
import { getBalance } from '@/modules/credits/service';
import { getStorage } from '@/modules/storage/service';
import { md5 } from '@/lib/hash';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';
import { assertPublicUrl } from '@/lib/url-guard';

/**
 * POST /api/playground/screenshot — used by the "URL → clone" Playground chip.
 *
 * Validates the URL (SSRF/abuse hygiene via assertPublicUrl), asks the
 * configured screenshot provider for a full-page PNG, persists it through the
 * same storage path as media uploads (R2 when configured, else public/uploads),
 * and returns the image URL. The frontend then attaches that URL to a normal
 * `/api/playground/chat` clone turn — no chat-side changes needed.
 *
 * Login is required: each call spends a real external API request.
 */

// Dev ceiling for the no-storage local-disk fallback (shared with upload-media).
const INLINE_MAX_BYTES =
  (Number(envConfigs.inline_image_max_kb) || 10240) * 1024;

async function POST({ request }: { request: Request }) {
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: 6000,
    keyPrefix: 'playground-screenshot',
  });
  if (limited) return limited;

  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized', { status: 401 });

    // Paid feature: only users with a credit balance (i.e. who bought a pack)
    // may spend an external screenshot API request.
    const balance = await getBalance(session.user.id);
    if (balance <= 0) return respErr('Insufficient credits', { status: 402 });

    const body = await request.json().catch(() => ({}));
    const raw = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!raw) return respErr('url is required', { status: 400 });

    let safe: { href: string };
    try {
      safe = assertPublicUrl(raw);
    } catch {
      return respErr('Invalid or blocked URL', { status: 400 });
    }

    const manager = await getScreenshot();
    if (!manager) {
      return respErr('Screenshot service is not configured', { status: 400 });
    }

    const shot = await manager.screenshot(safe.href);
    if (shot.body.length > INLINE_MAX_BYTES) {
      return respErr('Screenshot too large', { status: 413 });
    }

    // Persist (mirror upload-media: R2 when configured, else public/uploads).
    const digest = md5(shot.body);
    const ext = shot.contentType === 'image/jpeg' ? 'jpg' : 'png';
    const objectKey = `${digest}.${ext}`;
    let imageUrl: string;

    const storage = await getStorage();
    if (storage) {
      const r = await storage.uploadFile({
        body: shot.body,
        key: objectKey,
        contentType: shot.contentType,
        disposition: 'inline',
      });
      if (!r.success || !r.url) {
        return respErr(r.error || 'Upload failed');
      }
      imageUrl = r.url;
    } else {
      const dir = path.join(process.cwd(), 'public', 'uploads');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, objectKey), shot.body);
      imageUrl = `/uploads/${objectKey}`;
    }

    return respData({ url: imageUrl, type: 'image' });
  } catch (e: any) {
    return respErr(e?.message || 'Screenshot failed');
  }
}

export const Route = createFileRoute('/api/playground/screenshot')({
  server: {
    handlers: { POST },
  },
});
