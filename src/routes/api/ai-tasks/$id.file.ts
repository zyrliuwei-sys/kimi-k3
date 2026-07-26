import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { AITaskStatus, findTask } from '@/modules/ai-tasks/service';
import { getStorage } from '@/modules/storage/service';
import { respErr } from '@/lib/resp';

import { parseTaskResult } from './-shared';

function mediaHeaders(options: {
  mime: string;
  filename: string;
  download: boolean;
  contentLength?: number;
  contentRange?: string | null;
}) {
  const headers = new Headers({
    'Content-Type': options.mime || 'video/mp4',
    'Content-Disposition': `${options.download ? 'attachment' : 'inline'}; filename="${options.filename}"`,
    'Cache-Control': 'private, max-age=3600',
    'Accept-Ranges': 'bytes',
  });
  if (options.contentLength != null) {
    headers.set('Content-Length', String(options.contentLength));
  }
  if (options.contentRange) {
    headers.set('Content-Range', options.contentRange);
  }
  return headers;
}

function bufferedResponse(options: {
  bytes: Buffer;
  mime: string;
  filename: string;
  download: boolean;
  rangeHeader: string | null;
}) {
  const total = options.bytes.length;
  const match = options.rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const requestedEnd = match[2] ? Number(match[2]) : total - 1;
    const end = Math.min(requestedEnd, total - 1);
    if (!Number.isFinite(start) || start < 0 || start > end || start >= total) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` },
      });
    }
    const slice = options.bytes.subarray(start, end + 1);
    return new Response(new Uint8Array(slice), {
      status: 206,
      headers: mediaHeaders({
        mime: options.mime,
        filename: options.filename,
        download: options.download,
        contentLength: slice.length,
        contentRange: `bytes ${start}-${end}/${total}`,
      }),
    });
  }

  return new Response(new Uint8Array(options.bytes), {
    headers: mediaHeaders({
      mime: options.mime,
      filename: options.filename,
      download: options.download,
      contentLength: total,
    }),
  });
}

/**
 * Authenticated video file proxy. Generated outputs may live in a private R2
 * bucket, so exposing the raw S3 endpoint produces a 401 in the browser.
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
    if (task.status !== AITaskStatus.SUCCESS) {
      return respErr('Video is not ready', { status: 409 });
    }

    const result = parseTaskResult(task.taskResult);
    const download = new URL(request.url).searchParams.get('download') === '1';
    const filename = `seedance-${task.id}.mp4`;
    const rangeHeader = request.headers.get('range');

    // Seedance rehosting uses a deterministic key. This fallback also repairs
    // tasks created before videoStorageKey was persisted in taskResult.
    const storageKey =
      result.videoStorageKey ||
      (task.provider === 'evolink-video'
        ? `evolink/video/${task.id}.mp4`
        : undefined);
    if (storageKey) {
      const storage = await getStorage();
      if (storage) {
        try {
          const file = await storage.downloadFile({ key: storageKey });
          if (file) {
            return bufferedResponse({
              bytes: file.bytes,
              mime: file.mime || 'video/mp4',
              filename,
              download,
              rangeHeader,
            });
          }
        } catch (error: any) {
          console.warn(
            '[ai-video-file] signed storage download failed, using provider URL:',
            error?.message
          );
        }
      }
    }

    const remoteUrl = result.originalVideoUrl || result.videoUrl;
    if (typeof remoteUrl !== 'string' || !/^https:\/\//i.test(remoteUrl)) {
      return respErr('Video file is unavailable', { status: 404 });
    }

    const upstream = await fetch(remoteUrl, {
      headers: rangeHeader ? { Range: rangeHeader } : undefined,
      redirect: 'follow',
    });
    if (!upstream.ok && upstream.status !== 206) {
      return respErr('Video file is unavailable', { status: 502 });
    }

    const headers = mediaHeaders({
      mime: upstream.headers.get('content-type') || 'video/mp4',
      filename,
      download,
      contentLength:
        Number(upstream.headers.get('content-length')) || undefined,
      contentRange: upstream.headers.get('content-range'),
    });
    return new Response(upstream.body, {
      status: upstream.status === 206 ? 206 : 200,
      headers,
    });
  } catch (error: any) {
    return respErr(error?.message || 'Failed to download video', {
      status: 500,
    });
  }
}

export const Route = createFileRoute('/api/ai-tasks/$id/file')({
  server: { handlers: { GET } },
});
