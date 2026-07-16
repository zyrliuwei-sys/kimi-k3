/**
 * Minimal OpenAI-compatible chat-completion client.
 *
 * Server-only. Works with any endpoint that implements the
 * `/v1/chat/completions` shape (OpenAI, Moonshot/Kimi, Together, OpenRouter,
 * vLLM, …). The chat service resolves credentials from DB config + env, then
 * hands them here as plain values so this module stays free of config/db deps.
 */
export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionParams {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatTurn[];
  temperature?: number;
  signal?: AbortSignal;
}

export async function openaiChatCompletion(
  params: ChatCompletionParams
): Promise<string> {
  const {
    apiKey,
    baseUrl,
    model,
    messages,
    temperature = 0.7,
    signal,
  } = params;

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature, stream: false }),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `Chat request failed (${res.status}): ${detail.slice(0, 300)}`
    );
  }

  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from model');
  return content;
}
