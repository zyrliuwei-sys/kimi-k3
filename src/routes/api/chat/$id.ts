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
  const { id } = params;

  // Validate auth + ownership + content BEFORE opening the stream, so any
  // rejection comes back as a normal JSON error envelope (respErr) that the
  // client can surface as a toast. Once we start streaming we can only signal
  // failure via an SSE `error` frame.
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return respErr('Unauthorized');
  const chat = await chatService.getChat({
    userId: session.user.id,
    chatId: id,
  });
  if (!chat) return respErr('Chat not found');

  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return respErr('Content is required');
  if (content.length > 8000) return respErr('Message is too long');

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: chatService.ChatStreamEvent) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      try {
        for await (const event of chatService.streamMessage({
          userId: chat.userId,
          chatId: id,
          content,
          signal: request.signal,
        })) {
          push(event);
        }
      } catch (error: any) {
        push({ type: 'error', message: error?.message || 'Stream failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // Disable any proxy buffering so tokens flush immediately.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
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
