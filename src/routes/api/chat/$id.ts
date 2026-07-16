import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import * as chatService from '@/modules/chat/service';
import { messageText } from '@/modules/chat/service';
import { respData, respErr, respOk } from '@/lib/resp';

async function requireOwnedChat(request: Request, id: string) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new Error('Unauthorized');
  const chat = await chatService.getChat({
    userId: session.user.id,
    chatId: id,
  });
  if (!chat) throw new Error('Chat not found');
  return { session, chat };
}

async function GET({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  try {
    const { id } = params;
    const { chat } = await requireOwnedChat(request, id);
    const messages = await chatService.listMessages({
      userId: chat.userId,
      chatId: id,
    });
    return respData({
      chat,
      messages: (messages ?? []).map((m) => ({
        id: m.id,
        role: m.role,
        content: messageText(m),
        createdAt: m.createdAt,
      })),
    });
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

async function POST({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  try {
    const { id } = params;
    const { chat } = await requireOwnedChat(request, id);

    const body = await request.json().catch(() => ({}));
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return respErr('Content is required');
    if (content.length > 8000) return respErr('Message is too long');

    const result = await chatService.sendMessage({
      userId: chat.userId,
      chatId: id,
      content,
    });

    return respData({
      userMessage: {
        id: result.userMessage.id,
        role: result.userMessage.role,
        content: messageText(result.userMessage),
        createdAt: result.userMessage.createdAt,
      },
      assistantMessage: {
        id: result.assistantMessage.id,
        role: result.assistantMessage.role,
        content: messageText(result.assistantMessage),
        createdAt: result.assistantMessage.createdAt,
      },
    });
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

async function DELETE({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  try {
    const { id } = params;
    const { session } = await requireOwnedChat(request, id);
    await chatService.deleteChat({ userId: session.user.id, chatId: id });
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export const Route = createFileRoute('/api/chat/$id')({
  server: {
    handlers: { GET, POST, DELETE },
  },
});
