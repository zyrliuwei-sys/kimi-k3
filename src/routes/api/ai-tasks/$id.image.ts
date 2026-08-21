import { createFileRoute } from '@tanstack/react-router';

import { extractImageUrls } from '@/core/ai/image-urls';
import { getAuth } from '@/core/auth';
import { findTask } from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';
import { getStorage } from '@/modules/storage/service';
import { respErr } from '@/lib/resp';

import { parseTaskResult } from './-shared';

/**
 * Authenticated image proxy for aiTask rows.
 *
 * The browser cannot `fetch()` directly across to the upstream provider
 * (Evolink / Replicate / etc.) — those URLs lack our `Access-Control-
 * Allow-Origin` header, so a client-side `fetch(url).then(r => r.blob())`
 * dies with a CORS error.
 *
 * This handler streams the image server-to-server (no CORS) and forwards
 * it to the client, stamping `Content-Disposition: attachment` so the
 * browser pops the native **"Save As"** dialog (folder + filename picker)
 * instead of navigating to the raw image.
 *
 * Implementation note: the response is a **streaming passthrough** —
 * we attach `Response.body` directly to the upstream `Response.body`.
 * Chrome / Edge pop the download UI the *instant* they see the response
 * headers, before any body chunk arrives. Buffering the full payload
 * (the previous shape of this handler) forced the user to wait for the
 * entire image to download before the dialog appeared — wrong cost for
 * a "save to disk" action.
 */
async function GET({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized', { status: 401 });

    const task = await findTask(params.id);
    if (!task || task.userId !== session.user.id) {
      return respErr('Task not found', { status: 404 });
    }

    const result = parseTaskResult(task.taskResult);
    // imageTasks land here with an `imageUrls[]` array, plus a legacy
    // `imageUrl` fallback. `?index=N` lets galleries serve every image in a
    // multi-image batch through this same-origin proxy, avoiding CSP blocks
    // from short-lived provider/CDN hosts.
    const imageUrls = extractImageUrls({
      ...result,
      imageUrls: result.imageUrls ?? result.images,
      imageUrl: result.imageUrl,
    });
    const requestedIndex = Number(
      new URL(request.url).searchParams.get('index') ?? 0
    );
    const index = Number.isInteger(requestedIndex)
      ? Math.max(0, Math.min(requestedIndex, imageUrls.length - 1))
      : 0;
    const download = new URL(request.url).searchParams.get('download') === '1';
    const filename = `image-${task.id}-${index + 1}.png`;

    // Image rehosting runs after the initial provider response. Prefer the
    // durable storage object once it exists: provider image URLs are often
    // short-lived, so refetching them is the main reason an older gallery
    // tile could remain on its loading skeleton forever. The deterministic
    // key also repairs tasks made before `imageStorageKeys` was persisted.
    const storageKey =
      result.imageStorageKeys?.[index] ||
      (task.provider === 'evolink-image'
        ? `evolink/image/${task.id}-${index}.png`
        : undefined);
    if (storageKey) {
      const storage = await getStorage();
      if (storage) {
        try {
          const file = await storage.downloadFile({ key: storageKey });
          if (file?.bytes) {
            return new Response(new Uint8Array(file.bytes), {
              headers: new Headers({
                'Content-Type': file.mime || 'image/png',
                'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
                'Cache-Control': 'private, max-age=3600',
                'Content-Length': String(file.bytes.length),
              }),
            });
          }
        } catch (error: any) {
          // The provider URL below is still a valid short-term fallback when
          // storage is unavailable or this particular upload did not finish.
          console.warn(
            '[ai-image] storage read failed, using provider URL:',
            error?.message
          );
        }
      }
    }

    const sourceUrl = imageUrls[index];
    if (!sourceUrl) {
      return respErr('Image is unavailable', { status: 404 });
    }

    // New tasks have already normalized relative provider paths. This branch
    // keeps older rows renderable too, instead of treating `/files/...` as a
    // route on our own application.
    let imageUrl = sourceUrl;
    if (!/^https?:\/\//i.test(imageUrl)) {
      const configs = await getAllConfigs();
      const baseUrl = (
        configs.evolink_base_url || 'https://api.evolink.ai/v1'
      ).replace(/\/$/, '');
      try {
        imageUrl = new URL(imageUrl, `${baseUrl}/`).toString();
      } catch {
        return respErr('Image URL is invalid', { status: 404 });
      }
    }

    const upstream = await fetch(imageUrl, { redirect: 'follow' });
    if (!upstream.ok) {
      return respErr('Upstream image is unavailable', { status: 502 });
    }
    // Best-effort MIME detection: trust upstream `content-type`, fall
    // back to the URL extension, then PNG.
    const upstreamType = upstream.headers.get('content-type') || '';
    const extMatch = imageUrl.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i);
    const inferredExt = extMatch
      ? extMatch[1].toLowerCase().replace('jpg', 'jpeg')
      : 'png';
    // Some object stores return `application/octet-stream` for perfectly
    // valid image bytes. Passing that through leaves Chromium unable to
    // paint an <img>; only trust an explicit `image/*` header.
    const mime = /^image\//i.test(upstreamType)
      ? upstreamType.split(';')[0]
      : inferredExt === 'jpeg'
        ? 'image/jpeg'
        : `image/${inferredExt}`;

    // Streaming passthrough: `Response.body` is a `ReadableStream` that
    // Node / Nitro / Edge runtimes will pipe to the client as it fills.
    // The status line + headers above (including `Content-Disposition`)
    // flush immediately on the first byte of the upstream body — that
    // is the moment Chrome / Edge fire the native "Save As" picker.
    return new Response(upstream.body, {
      headers: new Headers({
        'Content-Type': mime,
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600',
      }),
    });
  } catch (error: any) {
    console.warn('[ai-image] proxy failed:', error?.message);
    return respErr(error?.message || 'Failed to download image', {
      status: 500,
    });
  }
}

export const Route = createFileRoute('/api/ai-tasks/$id/image')({
  server: { handlers: { GET } },
});
