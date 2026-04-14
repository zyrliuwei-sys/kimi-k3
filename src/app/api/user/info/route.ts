import { headers } from 'next/headers';
import { respData, respErr } from '@/lib/resp';
import { getAuth } from '@/core/auth';

export async function GET() {
  try {
    const auth = getAuth();
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });

    if (!session?.user) {
      return respErr('Unauthorized');
    }

    return respData({
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
    });
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
