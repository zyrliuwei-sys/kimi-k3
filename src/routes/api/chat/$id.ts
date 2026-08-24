import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import * as chatService from '@/modules/chat/service';
import { messageText } from '@/modules/chat/service';
import { parseDocument } from '@/modules/doc-library/parser';
import { getStorage } from '@/modules/storage/service';
import { respData, respErr, respOk } from '@/lib/resp';

const MAX_DOCUMENT_CONTEXT_CHARS = 500_000;

interface ChatAttachment {
  type: 'image' | 'video' | 'document';
  url: string;
  key?: string;
  filename?: string;
}

/**
 * Persistent chat stores only the user's typed message, not a giant extracted
 * spreadsheet/PDF body. This produces transient context for the current model
 * turn from storage-backed document attachments, while keeping the saved
 * transcript readable and reasonably sized.
 */
async function buildAttachmentContext(
  attachments: ChatAttachment[]
): Promise<string> {
  const documents = attachments.filter(
    (attachment) => attachment.type === 'document'
  );
  const videos = attachments.filter(
    (attachment) => attachment.type === 'video'
  );
  if (!documents.length && !videos.length) return '';

  const storage = await getStorage();
  const documentTexts = await Promise.all(
    documents.map(async (attachment) => {
      const label = attachment.filename || 'document';
      try {
        let bytes: Buffer | null = null;
        let mimeType = 'application/octet-stream';

        if (attachment.key && storage) {
          const result = await storage.downloadFile({ key: attachment.key });
          if (result) {
            bytes = result.bytes;
            mimeType = result.mime || mimeType;
          }
        }

        if (!bytes && attachment.url.startsWith('/uploads/')) {
          const uploadsRoot = path.join(process.cwd(), 'public', 'uploads');
          const resolved = path.resolve(
            uploadsRoot,
            attachment.url.replace(/^\/uploads\//, '')
          );
          if (
            !resolved.startsWith(uploadsRoot + path.sep) &&
            resolved !== uploadsRoot
          ) {
            throw new Error('Invalid local upload path');
          }
          bytes = await readFile(resolved);
        }

        if (!bytes) {
          throw new Error('The uploaded file is no longer available');
        }

        const parsed = await parseDocument({
          buffer: bytes,
          mimeType,
          filename: label,
        });
        const text = parsed.text.slice(0, MAX_DOCUMENT_CONTEXT_CHARS);
        const truncation =
          parsed.text.length > MAX_DOCUMENT_CONTEXT_CHARS || parsed.truncated
            ? '\n\n[Document text was truncated for this chat turn.]'
            : '';
        return `--- Begin document: ${label} ---\n${text}\n--- End document: ${label} ---${truncation}`;
      } catch (error: any) {
        // A corrupt or unavailable file should not take down the entire chat
        // request. The model gets an explicit, useful note instead.
        return `[Could not read attached document "${label}": ${error?.message || 'parse failed'}]`;
      }
    })
  );

  const videoNotes = videos.map(
    (attachment) =>
      `[Attached video${attachment.filename ? `: ${attachment.filename}` : ''}]`
  );
  return [...documentTexts, ...videoNotes].join('\n\n');
}

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
  const attachments: ChatAttachment[] = Array.isArray(body.attachments)
    ? body.attachments.filter(
        (attachment: unknown): attachment is ChatAttachment => {
          if (!attachment || typeof attachment !== 'object') return false;
          const value = attachment as Partial<ChatAttachment>;
          return (
            (value.type === 'image' ||
              value.type === 'video' ||
              value.type === 'document') &&
            typeof value.url === 'string' &&
            !value.url.startsWith('blob:')
          );
        }
      )
    : [];

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
          attachmentContext: buildAttachmentContext(attachments),
          // Do not pass request.signal to the upstream model. In a streamed
          // response Nitro may mark the completed request body as aborted,
          // which used to cut an otherwise healthy reply off mid-generation.
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
