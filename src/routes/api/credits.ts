import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { countUserActiveTasks } from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';
import { getBalance, getHistory } from '@/modules/credits/service';
import { getRemainingQuota } from '@/modules/subscription-quota/service';
import { readImageFirstFree } from '@/lib/image-billing';
import { respData, respErr } from '@/lib/resp';

async function GET({ request }: { request: Request }) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return respErr('Unauthorized');
    }

    const [balance, history, quota, configs, imageTaskCount] =
      await Promise.all([
        getBalance(session.user.id),
        getHistory(session.user.id),
        getRemainingQuota(session.user.id),
        getAllConfigs(),
        countUserActiveTasks(session.user.id, 'image'),
      ]);

    return respData({
      balance,
      history,
      // Chat can use either an active subscription slot or paid credits.
      // Exposing this lets the composer perform the same preflight check as
      // the streaming endpoint before it renders an optimistic message.
      chatAccess: quota.remaining > 0 || balance > 0,
      // The first eligible image is free even though the signup gift is not
      // included in the paid-credit balance returned above.
      imageFirstFreeAvailable:
        readImageFirstFree(configs) && imageTaskCount < 1,
    });
  } catch (error: any) {
    return respErr(error.message || 'Failed to get credits');
  }
}

export const Route = createFileRoute('/api/credits')({
  server: {
    handlers: { GET },
  },
});
