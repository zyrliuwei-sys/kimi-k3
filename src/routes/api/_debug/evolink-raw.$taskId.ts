import { createFileRoute } from '@tanstack/react-router';

import { EvolinkImageProvider } from '@/core/ai/evolink-image';
import { getAuth } from '@/core/auth';
import { findTask } from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';
import { respData, respErr } from '@/lib/resp';

/**
 * GET /api/_debug/evolink-raw/$taskId
 *
 * Diagnostic endpoint — hits Evolink's polling endpoint(s) directly
 * and returns the raw responses. We bypass the per-instance
 * `discoveredPollPath` cache so we always probe ALL candidate paths.
 *
 * Used to find out what field names / status strings Evolink actually
 * uses (we keep guessing and missing in the regular query path).
 *
 * Auth: required (returns 401 otherwise). Output: JSON with each
 * candidate path's HTTP status + body + the extracted URLs (or null
 * if we couldn't pull any).
 */
async function GET({
  request,
  params,
}: {
  request: Request;
  params: { taskId: string };
}) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized', { status: 401 });

    const task = await findTask(params.id);
    if (!task || task.userId !== session.user.id) {
      return respErr('Task not found', { status: 404 });
    }
    const stored = (task.taskResult as any) || {};
    const remoteTaskId = stored.remoteTaskId;
    if (!remoteTaskId) {
      return respErr('No remoteTaskId stored on task', { status: 400 });
    }

    const configs = await getAllConfigs();
    if (!configs.evolink_api_key) {
      return respErr('evolink_api_key not configured', { status: 400 });
    }
    const baseUrl = (
      configs.evolink_base_url || 'https://api.evolink.ai/v1'
    ).replace(/\/$/, '');

    const candidates = [
      `/images/generations/${remoteTaskId}`,
      `/image/generations/${remoteTaskId}`,
      `/image.generations/${remoteTaskId}`,
      `/tasks/${remoteTaskId}`,
      `/task/${remoteTaskId}`,
      `/image-tasks/${remoteTaskId}`,
      `/image.tasks/${remoteTaskId}`,
      `/v1/tasks/${remoteTaskId}`,
      `/v1/image/generations/${remoteTaskId}`,
    ];

    const probes: any[] = [];
    for (const p of candidates) {
      const url = `${baseUrl}${p}`;
      let resp: Response;
      let err: string | undefined;
      try {
        resp = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${configs.evolink_api_key}` },
        });
      } catch (e: any) {
        probes.push({ path: p, error: e?.message || 'fetch error' });
        continue;
      }
      if (!resp.ok) {
        probes.push({
          path: p,
          status: resp.status,
          statusText: resp.statusText,
        });
        continue;
      }
      const body: any = await resp.json().catch(() => ({}));
      // Surface every interesting field so we can see what the user
      // should be matching on.
      probes.push({
        path: p,
        status: resp.status,
        // Top-level keys
        topLevelKeys: Object.keys(body || {}),
        // Status candidates
        statusFields: {
          status: body?.status,
          state: body?.state,
          task_status: body?.task_status,
          taskState: body?.taskState,
          phase: body?.phase,
        },
        // URL candidates — first 200 chars of each
        urlCandidates: {
          url:
            typeof body?.url === 'string' ? body.url.slice(0, 200) : body?.url,
          image_url:
            typeof body?.image_url === 'string'
              ? body.image_url.slice(0, 200)
              : body.image_url,
          imageUrl:
            typeof body?.imageUrl === 'string'
              ? body.imageUrl.slice(0, 200)
              : body.imageUrl,
          output_url:
            typeof body?.output_url === 'string'
              ? body.output_url.slice(0, 200)
              : body.output_url,
        },
        // Array candidates — first item's keys + url
        arrayCandidates: {
          data: Array.isArray(body?.data)
            ? {
                len: body.data.length,
                firstKeys: Object.keys(body.data[0] || {}),
                firstItem: body.data[0],
              }
            : null,
          images: Array.isArray(body?.images)
            ? {
                len: body.images.length,
                firstKeys: Object.keys(body.images[0] || {}),
                firstItem: body.images[0],
              }
            : null,
          result: Array.isArray(body?.result)
            ? {
                len: body.result.length,
                firstKeys: Object.keys(body.result[0] || {}),
                firstItem: body.result[0],
              }
            : null,
          output: Array.isArray(body?.output)
            ? {
                len: body.output.length,
                firstKeys: Object.keys(body.output[0] || {}),
                firstItem: body.output[0],
              }
            : null,
        },
        // Full body for inspection (truncated to 4000 chars)
        body: JSON.stringify(body).slice(0, 4000),
      });
    }

    // Also report the DB task's current state for cross-reference.
    return respData({
      taskId: remoteTaskId,
      taskStatus: task.status,
      taskResult: stored,
      probes,
    });
  } catch (error: any) {
    return respErr(error.message || 'Debug endpoint failed');
  }
}

export const Route = createFileRoute('/api/_debug/evolink-raw/$taskId')({
  server: {
    handlers: { GET },
  },
});
