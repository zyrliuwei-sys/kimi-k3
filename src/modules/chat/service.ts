import { and, asc, eq } from 'drizzle-orm';

import { openaiChatCompletionStream, type ChatTurn } from '@/core/ai/chat';
import { db } from '@/core/db';
import {
  chat,
  chatMessage,
  type Chat,
  type ChatMessage,
} from '@/config/db/schema';
import { getConfig } from '@/modules/config/service';
import { getUuid } from '@/lib/hash';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT =
  'You are kimik3, a friendly, knowledgeable assistant powered by Kimi K3. You help people think, write, research, and build. Be concise, warm, and practical. Use Markdown when it improves clarity.';

const NOT_CONFIGURED_REPLY =
  "👋 I'm kimik3 — your AI workspace for chat, research, and content.\n\nNo live model is reachable yet. An admin can connect one from **Admin → Settings → AI** by pasting a key under the **EvoLink** group (`evolink_api_key`); set the model to `kimi-k3` — or leave it blank and Kimi K3 is used by default. Once that's in place, every message here gets a real Kimi K3 response.\n\nIn the meantime, your conversations are still saved here.";

export interface ChatModelConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

/**
 * Resolve the chat model config. Prefers the `evolink` provider (model defaults
 * to `kimi-k3` — Kimi K3) when its key is present, so an admin who only pasted
 * the key still gets a working Kimi K3 response. Falls back to OpenAI (or any
 * OpenAI-compatible endpoint) otherwise. Mirrors /api/playground/chat.
 * `hasKey` lets callers fall back to a friendly notice instead of erroring.
 */
export async function getChatModelConfig(): Promise<ChatModelConfig> {
  const evolinkKey = (await getConfig('evolink_api_key')) || '';
  if (evolinkKey) {
    return {
      provider: 'evolink',
      apiKey: evolinkKey,
      baseUrl:
        (await getConfig('evolink_base_url')) || 'https://api.evolink.ai/v1',
      model: (await getConfig('evolink_model')) || 'kimi-k3',
      hasKey: true,
    };
  }

  // Fall back to OpenAI (or any OpenAI-compatible endpoint under openai_*).
  const apiKey =
    (await getConfig('openai_api_key')) || process.env.OPENAI_API_KEY || '';
  const baseUrl =
    (await getConfig('openai_base_url')) ||
    process.env.OPENAI_BASE_URL ||
    DEFAULT_BASE_URL;
  const model =
    (await getConfig('openai_model')) ||
    process.env.OPENAI_MODEL ||
    DEFAULT_MODEL;
  return { provider: 'openai', apiKey, baseUrl, model, hasKey: !!apiKey };
}

function textFromParts(parts: unknown): string {
  if (typeof parts !== 'string') return String(parts ?? '');
  try {
    const parsed = JSON.parse(parts);
    if (Array.isArray(parsed)) {
      return parsed
        .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
        .join('');
    }
    return typeof parsed === 'string' ? parsed : '';
  } catch {
    return parts;
  }
}

function partsFromText(text: string): string {
  return JSON.stringify([{ type: 'text', text }]);
}

export async function createChat(params: {
  userId: string;
  title?: string;
  model?: string;
  provider?: string;
}): Promise<Chat> {
  const { userId, title = '', model, provider } = params;
  const cfg = await getChatModelConfig();
  const [row] = await db()
    .insert(chat)
    .values({
      id: getUuid(),
      userId,
      status: 'active',
      title,
      model: model || cfg.model,
      provider: provider || (cfg.hasKey ? cfg.provider : 'unconfigured'),
      parts: '[]',
    })
    .returning();
  return row;
}

export async function listChats(params: {
  userId: string;
  limit?: number;
}): Promise<Chat[]> {
  const { userId, limit = 50 } = params;
  return db()
    .select()
    .from(chat)
    .where(and(eq(chat.userId, userId), eq(chat.status, 'active')))
    .orderBy(asc(chat.updatedAt))
    .limit(limit);
}

export async function getChat(params: {
  userId: string;
  chatId: string;
}): Promise<Chat | null> {
  const { userId, chatId } = params;
  const [row] = await db()
    .select()
    .from(chat)
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
    .limit(1);
  if (!row || row.status !== 'active') return null;
  return row;
}

export async function listMessages(params: {
  userId: string;
  chatId: string;
}): Promise<ChatMessage[] | null> {
  const owned = await getChat(params);
  if (!owned) return null;
  return db()
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.chatId, params.chatId))
    .orderBy(asc(chatMessage.createdAt))
    .limit(200);
}

/** Public, wire-safe message shape (Date → ISO string) for API/SSE clients. */
export interface PublicMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/**
 * Events emitted while streaming a reply. The route layer turns each one into
 * an SSE `data:` frame. `done` carries both persisted messages so the client
 * can commit the canonical pair into its cache without an extra refetch flash.
 */
export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      userMessage: PublicMessage;
      assistantMessage: PublicMessage;
    }
  | { type: 'error'; message: string };

function toPublic(msg: ChatMessage): PublicMessage {
  return {
    id: msg.id,
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: textFromParts(msg.parts),
    createdAt: new Date(msg.createdAt).toISOString(),
  };
}

/** Persist the assistant turn + bump the chat's updatedAt (and title once). */
async function saveAssistantAndBump(params: {
  owned: Chat;
  content: string;
  text: string;
  model: string;
  provider: string;
}): Promise<ChatMessage> {
  const { owned, content, text, model, provider } = params;
  const assistantMessage: ChatMessage = {
    id: getUuid(),
    userId: owned.userId,
    chatId: owned.id,
    status: 'active',
    role: 'assistant',
    parts: partsFromText(text),
    model,
    provider,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db().insert(chatMessage).values(assistantMessage);

  const title = owned.title?.trim() ? {} : { title: content.slice(0, 60) };
  await db()
    .update(chat)
    .set({ ...title, updatedAt: new Date() })
    .where(eq(chat.id, owned.id));

  return assistantMessage;
}

/**
 * Stream a reply token-by-token. The user message is persisted together with
 * the assistant reply at the END — so if the client aborts mid-stream (Stop),
 * nothing is orphaned: the turn simply isn't saved. History is read before the
 * new user turn is appended in-memory, so the model sees the full conversation.
 *
 * `signal` aborts the upstream model fetch (Stop button / navigation). On abort
 * the generator returns without yielding `done`; on a real model error it yields
 * a friendly error note as the assistant text and still persists it.
 */
export async function* streamMessage(params: {
  userId: string;
  chatId: string;
  content: string;
  signal?: AbortSignal;
}): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const { userId, chatId, content, signal } = params;
  const owned = await getChat({ userId, chatId });
  if (!owned) {
    yield { type: 'error', message: 'Chat not found' };
    return;
  }

  // 1. build conversation history (prior turns only — new turn appended below)
  const history = await listMessages({ userId, chatId });
  const turns: ChatTurn[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const msg of history ?? []) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    turns.push({ role, content: textFromParts(msg.parts) });
  }
  turns.push({ role: 'user', content });

  // 2. resolve model config
  const cfg = await getChatModelConfig();
  const model = cfg.model || owned.model;
  const provider = cfg.hasKey ? cfg.provider : 'unconfigured';

  // 3. generate the assistant text — streaming when a live model is configured
  let assistantText = '';
  if (cfg.hasKey) {
    try {
      for await (const delta of openaiChatCompletionStream({
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model,
        messages: turns,
        signal,
      })) {
        if (!delta) continue;
        assistantText += delta;
        yield { type: 'delta', text: delta };
      }
    } catch (err: any) {
      if (signal?.aborted) return; // client stopped — discard, persist nothing
      assistantText = `⚠️ I couldn't reach the model just now.\n\n\`${err?.message || 'Unknown error'}\`\n\nPlease try again in a moment.`;
      yield { type: 'delta', text: assistantText };
    }
  } else {
    assistantText = NOT_CONFIGURED_REPLY;
    yield { type: 'delta', text: assistantText };
  }

  // 4. persist the user + assistant turns together, then emit the canonical pair
  const userMessage: ChatMessage = {
    id: getUuid(),
    userId,
    chatId,
    status: 'active',
    role: 'user',
    parts: partsFromText(content),
    model,
    provider,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db().insert(chatMessage).values(userMessage);
  const assistantMessage = await saveAssistantAndBump({
    owned,
    content,
    text: assistantText,
    model,
    provider,
  });

  yield {
    type: 'done',
    userMessage: toPublic(userMessage),
    assistantMessage: toPublic(assistantMessage),
  };
}

export async function deleteChat(params: {
  userId: string;
  chatId: string;
}): Promise<boolean> {
  const { userId, chatId } = params;
  const result = await db()
    .update(chat)
    .set({ status: 'deleted' })
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
    .returning();
  return result.length > 0;
}

export function messageText(msg: ChatMessage): string {
  return textFromParts(msg.parts);
}
