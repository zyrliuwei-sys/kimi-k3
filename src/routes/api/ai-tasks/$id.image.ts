import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { findTask } from '@/modules/ai-tasks/service';
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
    // imageTasks land here — the same shape the synced/async paths persist:
    // an `imageUrls[]` array, with an `imageUrl` single-string fallback.
    const firstUrl: string | undefined = (() => {
      if (Array.isArray(result.imageUrls) && result.imageUrls[0]) {
        return result.imageUrls[0];
      }
      if (typeof result.imageUrl === 'string' && result.imageUrl) {
        return result.imageUrl;
      }
      return undefined;
    })();
    if (!firstUrl || !/^https?:\/\//i.test(firstUrl)) {
      return respErr('Image is unavailable', { status: 404 });
    }

    const download = new URL(request.url).searchParams.get('download') === '1';
    const filename = `image-${task.id}.png`;

    const upstream = await fetch(firstUrl, { redirect: 'follow' });
    if (!upstream.ok) {
      return respErr('Upstream image is unavailable', { status: 502 });
    }
    // Best-effort MIME detection: trust upstream `content-type`, fall
    // back to the URL extension, then PNG.
    const upstreamType = upstream.headers.get('content-type') || '';
    const extMatch = firstUrl.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i);
    const inferredExt = extMatch
      ? extMatch[1].toLowerCase().replace('jpg', 'jpeg')
      : 'png';
    const mime =
      upstreamType ||
      (inferredExt === 'jpeg' ? 'image/jpeg' : `image/${inferredExt}`);

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
