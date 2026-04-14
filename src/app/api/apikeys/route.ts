import { headers } from 'next/headers';
import { respData, respOk, respErr } from '@/lib/resp';
import { getAuth } from '@/core/auth';
import * as apikeys from '@/modules/apikeys/service';

export async function GET() {
  try {
    const auth = getAuth();
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });

    if (!session?.user) {
      return respErr('Unauthorized');
    }

    const keys = await apikeys.list(session.user.id);
    return respData(keys);
  } catch (error: any) {
    return respErr(error.message || 'Failed to list API keys');
  }
}

export async function POST(req: Request) {
  try {
    const auth = getAuth();
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });

    if (!session?.user) {
      return respErr('Unauthorized');
    }

    const body = await req.json();
    const { title } = body;

    if (!title) {
      return respErr('Title is required');
    }

    const key = await apikeys.create({
      userId: session.user.id,
      title,
    });

    return respData(key);
  } catch (error: any) {
    return respErr(error.message || 'Failed to create API key');
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = getAuth();
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });

    if (!session?.user) {
      return respErr('Unauthorized');
    }

    const { searchParams } = new URL(req.url);
    const keyId = searchParams.get('id');

    if (!keyId) {
      return respErr('Key ID is required');
    }

    await apikeys.remove({ userId: session.user.id, keyId });
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Failed to delete API key');
  }
}
