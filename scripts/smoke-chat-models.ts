import { openaiChatCompletionStream } from '../src/core/ai/chat';
import {
  CHAT_MODEL_IDS,
  isPremiumChatModel,
  type ChatModelId,
} from '../src/lib/chat-billing';
import { getChatModelConfig } from '../src/modules/chat/service';

/**
 * Smoke-test every product-chat model ID against the live EvoLink gateway,
 * using the exact request shape production sends (stream +
 * stream_options.include_usage, no temperature on premium models,
 * max_completion_tokens for GPT-5.6). Verifies: the ID routes, the stream
 * opens, and a usage frame comes back (billing depends on it).
 *
 *   pnpm exec tsx scripts/with-env.ts tsx scripts/smoke-chat-models.ts
 */

async function testModel(
  cfg: { apiKey: string; baseUrl: string },
  model: ChatModelId
): Promise<{
  ok: boolean;
  ms: number;
  usage?: string;
  reply: string;
  err?: string;
}> {
  const started = Date.now();
  let text = '';
  let usage: string | undefined;
  try {
    for await (const chunk of openaiChatCompletionStream({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      includeTemperature: !isPremiumChatModel(model),
      maxCompletionTokens: 64,
      maxCompletionTokenField:
        model === 'gpt-5.6-sol' ? 'max_completion_tokens' : 'max_tokens',
      signal: AbortSignal.timeout(90_000),
    })) {
      if (typeof chunk === 'string') {
        text += chunk;
      } else if (chunk.usage) {
        const u = chunk.usage;
        usage =
          `in=${u.prompt_tokens} out=${u.completion_tokens}` +
          (u.cached_tokens ? ` cached=${u.cached_tokens}` : '') +
          (u.cache_write_tokens ? ` cacheW=${u.cache_write_tokens}` : '');
      }
    }
    return {
      ok: true,
      ms: Date.now() - started,
      usage,
      reply: text.trim().slice(0, 60),
    };
  } catch (err: any) {
    return {
      ok: false,
      ms: Date.now() - started,
      reply: text.trim().slice(0, 60),
      err: String(err?.message || err).slice(0, 160),
    };
  }
}

async function main() {
  const cfg = await getChatModelConfig();
  if (!cfg.hasKey || cfg.provider !== 'evolink') {
    console.error(
      `Expected a configured evolink key, got provider=${cfg.provider} hasKey=${cfg.hasKey}`
    );
    process.exit(1);
  }
  console.log(`Gateway: ${cfg.baseUrl}\n`);

  let pass = 0;
  let fail = 0;
  for (const model of CHAT_MODEL_IDS) {
    const r = await testModel(cfg, model);
    if (r.ok) pass++;
    else fail++;
    const status = r.ok ? '✓' : '✗';
    const detail = r.ok
      ? `${r.usage ?? 'NO USAGE FRAME'} | "${r.reply}"`
      : `ERROR: ${r.err}`;
    console.log(
      `${status} ${model.padEnd(18)} ${String(r.ms).padStart(6)}ms  ${detail}`
    );
  }
  console.log(
    `\n${pass}/${CHAT_MODEL_IDS.length} passed${fail ? `, ${fail} FAILED` : ''}`
  );
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
