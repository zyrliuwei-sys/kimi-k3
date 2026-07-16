import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import * as chatService from '@/modules/chat/service';
import { respData, respErr } from '@/lib/resp';

async function GET({ request }: { request: Request }) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized');

    const chats = await chatService.listChats({ userId: session.user.id });
    return respData({ chats });
  } catch (error: any) {
    return respErr(error.message || 'Failed to list chats');
  }
}

async function POST({ request }: { request: Request }) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized');

    const body = await request.json().catch(() => ({}));
    const title = typeof body.title === 'string' ? body.title.trim() : '';

    const chat = await chatService.createChat({
      userId: session.user.id,
      title,
    });
    return respData({ chat });
  } catch (error: any) {
    return respErr(error.message || 'Failed to create chat');
  }
}

export const Route = createFileRoute('/api/chat/')({
  server: {
    handlers: { GET, POST },
  },
});
