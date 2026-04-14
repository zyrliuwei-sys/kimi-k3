import { headers } from 'next/headers';
import { respData, respErr } from '@/lib/resp';
import { getAuth } from '@/core/auth';
import { getBalance, getHistory } from '@/modules/credits/service';

export async function GET() {
  try {
    const auth = getAuth();
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });

    if (!session?.user) {
      return respErr('Unauthorized');
    }

    const [balance, history] = await Promise.all([
      getBalance(session.user.id),
      getHistory(session.user.id),
    ]);

    return respData({ balance, history });
  } catch (error: any) {
    return respErr(error.message || 'Failed to get credits');
  }
}
