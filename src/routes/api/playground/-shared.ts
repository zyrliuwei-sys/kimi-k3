import { getConfig } from '@/modules/config/service';
import {
  DEFAULT_CHAT_MODEL_ID,
  getChatModelDisplayName,
} from '@/lib/chat-billing';

/**
 * Shared helpers for the stateless playground endpoints (`/api/playground/chat`
 * single-model, `/api/playground/compare` multi-model fan-out). Extracted so
 * both routes resolve provider config, system prompt, and SSE plumbing the
 * same way instead of drifting apart.
 */

export interface PlaygroundConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export type SseEmit = (obj: Record<string, unknown>) => void;

/**
 * Resolve the model config for the playground. Prefers EvoLink when
 * its key is present, otherwise falls back to OpenAI. Same logic as
 * getChatModelConfig() in the chat service.
 */
export async function resolvePlaygroundConfig(): Promise<PlaygroundConfig> {
  const evolinkKey = (await getConfig('evolink_api_key')) || '';
  if (evolinkKey) {
    return {
      provider: 'evolink',
      apiKey: evolinkKey,
      baseUrl:
        (await getConfig('evolink_base_url')) || 'https://api.evolink.ai/v1',
      model: (await getConfig('evolink_model')) || DEFAULT_CHAT_MODEL_ID,
      hasKey: true,
    };
  }

  const apiKey =
    (await getConfig('openai_api_key')) || process.env.OPENAI_API_KEY || '';
  const baseUrl =
    (await getConfig('openai_base_url')) ||
    process.env.OPENAI_BASE_URL ||
    'https://api.openai.com/v1';
  const model =
    (await getConfig('openai_model')) || process.env.OPENAI_MODEL || '';
  return { provider: 'openai', apiKey, baseUrl, model, hasKey: !!apiKey };
}

/** Build a `text/event-stream` Response that runs `work`, emitting frames. */
export function sseResponse(work: (emit: SseEmit) => Promise<void>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit: SseEmit = (obj) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        await work(emit);
      } catch (e: any) {
        emit({ t: 'error', message: e?.message || 'Stream failed' });
      } finally {
        controller.close();
      }
    },
  });
  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  return new Response(stream, { headers });
}

export function getSystemPrompt(model: string): string {
  const modelName = getChatModelDisplayName(model);
  return `You are ${modelName}, the model selected for this conversation. kimik3 is the product name, not your model identity. If asked who you are or which model is replying, identify yourself as ${modelName}; never say that you are kimik3 or that you cannot verify your model identity. Be concise, warm, and practical. Use Markdown when it improves clarity. Attached images: respond to what you see. Attached documents (PDF, Word, Excel, PPT, Apple Pages, Apple Numbers, MD, TXT, CSV): their parsed text is inlined in the user message — answer from it directly. Excel tables include a Formula column — use the formulas, not just the values. PPT slides include "Speaker notes:" — read those for intent.`;
}

export const NOT_CONFIGURED_REPLY = `👋 I'm kimik3 — but no live model is reachable yet.

An admin needs to connect one from **Admin → Settings → AI**:
1. Paste your key under the **evolink** group (\`evolink_api_key\`).
2. Set the model to **\`kimi-k3\`** (\`evolink_model\`) — or leave it blank and Kimi K3 is used by default.

Once that's in place, every message uses the selected live model.`;
