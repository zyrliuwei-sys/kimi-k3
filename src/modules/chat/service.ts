import { and, asc, eq } from 'drizzle-orm';

import { openaiChatCompletion, type ChatTurn } from '@/core/ai/chat';
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
  'You are kimik3, a friendly, knowledgeable assistant powered by the kimik3 model. You help people think, write, research, and build. Be concise, warm, and practical. Use Markdown when it improves clarity.';

const NOT_CONFIGURED_REPLY =
  "👋 I'm kimik3 — your AI workspace for chat, research, and content.\n\nNo AI provider is configured yet, so I can't reach a live model. An admin can connect one from **Admin → Settings** by setting an OpenAI-compatible `openai_api_key` (plus optional `openai_base_url` and `openai_model`). Once that's in place, every message here gets a real response.\n\nIn the meantime, your conversations are still saved here.";

/**
 * Resolve the chat model config: DB config (admin) wins, then process.env.
 * `hasKey` lets callers fall back to a friendly notice instead of erroring.
 */
export async function getChatModelConfig() {
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
  return { apiKey, baseUrl, model, hasKey: !!apiKey };
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
      provider: provider || (cfg.hasKey ? 'openai' : 'unconfigured'),
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

export interface SendMessageResult {
  chatId: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

export async function sendMessage(params: {
  userId: string;
  chatId: string;
  content: string;
}): Promise<SendMessageResult> {
  const { userId, chatId, content } = params;
  const owned = await getChat({ userId, chatId });
  if (!owned) throw new Error('Chat not found');

  // 1. persist the user's message
  const userMessage: ChatMessage = {
    id: getUuid(),
    userId,
    chatId,
    status: 'active',
    role: 'user',
    parts: partsFromText(content),
    model: owned.model,
    provider: owned.provider,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db().insert(chatMessage).values(userMessage);

  // 2. build conversation history (system + prior turns)
  const history = await listMessages({ userId, chatId });
  const turns: ChatTurn[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const msg of history ?? []) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    turns.push({ role, content: textFromParts(msg.parts) });
  }

  // 3. generate the assistant reply (real model if configured, else a notice)
  const cfg = await getChatModelConfig();
  let assistantText: string;
  if (cfg.hasKey) {
    try {
      assistantText = await openaiChatCompletion({
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model || owned.model,
        messages: turns,
      });
    } catch (err: any) {
      assistantText = `⚠️ I couldn't reach the model just now.\n\n\`${err?.message || 'Unknown error'}\`\n\nPlease try again in a moment.`;
    }
  } else {
    assistantText = NOT_CONFIGURED_REPLY;
  }

  // 4. persist the assistant message
  const assistantMessage: ChatMessage = {
    id: getUuid(),
    userId,
    chatId,
    status: 'active',
    role: 'assistant',
    parts: partsFromText(assistantText),
    model: cfg.model || owned.model,
    provider: cfg.hasKey ? 'openai' : 'unconfigured',
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db().insert(chatMessage).values(assistantMessage);

  // 5. bump the chat + derive a title from the first user message
  const title = owned.title?.trim() ? {} : { title: content.slice(0, 60) };
  await db()
    .update(chat)
    .set({ ...title, updatedAt: new Date() })
    .where(eq(chat.id, chatId));

  return { chatId, userMessage, assistantMessage };
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
