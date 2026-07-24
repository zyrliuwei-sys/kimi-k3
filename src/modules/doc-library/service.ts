import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { openaiChatCompletionStream } from '@/core/ai/chat';
import { db } from '@/core/db';
import {
  docCollection,
  docCollectionDocument,
  docCollectionMessage,
} from '@/config/db/schema';
import { getConfig } from '@/modules/config/service';
import { consumeMessage } from '@/modules/subscription-quota/service';
import { getUuid } from '@/lib/hash';
import { respErr } from '@/lib/resp';

import { parseDocument, type ParsedDocument } from './parser';
import { buildAskPrompt, SYSTEM_PROMPT } from './prompts';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CollectionInput {
  name: string;
  description?: string;
}

export interface DocumentInput {
  collectionId: string;
  filename: string;
  storageUrl: string;
  storageKey?: string;
  mimeType: string;
  fileBytes: number;
}

export interface AskInput {
  collectionId: string;
  question: string;
  userId: string;
}

export interface AskSource {
  docId: string;
  filename: string;
  page?: number;
  quote: string;
}

// SSE event types emitted by streamAsk(). Mirrors the playground chat shape so
// the client can reuse the same handler.
export type AskStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: AskSource[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

// ─── Collection CRUD ─────────────────────────────────────────────────────────

export async function createCollection(params: {
  userId: string;
  input: CollectionInput;
}) {
  const id = getUuid();
  const [row] = await db()
    .insert(docCollection)
    .values({
      id,
      userId: params.userId,
      name: params.input.name,
      description: params.input.description ?? '',
    })
    .returning();
  return row;
}

export async function listCollections(userId: string) {
  return db()
    .select()
    .from(docCollection)
    .where(eq(docCollection.userId, userId))
    .orderBy(desc(docCollection.updatedAt));
}

export async function getCollection(userId: string, id: string) {
  const [row] = await db()
    .select()
    .from(docCollection)
    .where(and(eq(docCollection.id, id), eq(docCollection.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function updateCollection(
  userId: string,
  id: string,
  patch: Partial<CollectionInput>
) {
  const [row] = await db()
    .update(docCollection)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(docCollection.id, id), eq(docCollection.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteCollection(userId: string, id: string) {
  // FK ON DELETE CASCADE handles the documents + messages children.
  const result = await db()
    .delete(docCollection)
    .where(and(eq(docCollection.id, id), eq(docCollection.userId, userId)))
    .returning();
  return result.length > 0;
}

// ─── Document CRUD ───────────────────────────────────────────────────────────

export async function addDocument(params: {
  userId: string;
  input: DocumentInput;
}) {
  // Refuse the insert if the parent collection isn't owned by the caller.
  const owner = await getCollection(params.userId, params.input.collectionId);
  if (!owner) throw new Error('Collection not found');

  const id = getUuid();
  const [row] = await db()
    .insert(docCollectionDocument)
    .values({
      id,
      collectionId: params.input.collectionId,
      userId: params.userId,
      filename: params.input.filename,
      storageUrl: params.input.storageUrl,
      storageKey: params.input.storageKey ?? '',
      mimeType: params.input.mimeType,
      fileBytes: params.input.fileBytes,
      parseStatus: 'processing',
    })
    .returning();
  return row;
}

/**
 * Fetch the raw bytes from a doc's storageUrl and parse it into plain text +
 * per-page metadata. On success we write the parsed payload back to the row
 * (`success` / `truncated` status) and bump the parent collection's
 * aggregates; on failure we record the error message so the UI can show it.
 *
 * Runs synchronously inside the upload HTTP request. Heavier files (>5MB)
 * should be moved to a background job in V2.
 */
export async function parseAndStoreDocument(params: {
  userId: string;
  docId: string;
}) {
  const [doc] = await db()
    .select()
    .from(docCollectionDocument)
    .where(eq(docCollectionDocument.id, params.docId))
    .limit(1);
  if (!doc || doc.userId !== params.userId)
    throw new Error('Document not found');

  let parsed: ParsedDocument;
  try {
    const res = await fetch(doc.storageUrl);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    parsed = await parseDocument({
      buffer: buf,
      mimeType: doc.mimeType,
      filename: doc.filename,
    });
  } catch (err: any) {
    await db()
      .update(docCollectionDocument)
      .set({
        parseStatus: 'failed',
        parseError: err?.message ?? 'parse failed',
        updatedAt: new Date(),
      })
      .where(eq(docCollectionDocument.id, doc.id));
    await refreshCollectionAggregates(doc.collectionId);
    throw err;
  }

  await db()
    .update(docCollectionDocument)
    .set({
      parseStatus: parsed.truncated ? 'truncated' : 'success',
      parseError: null,
      contentText: parsed.text,
      contentMeta: JSON.stringify(parsed.meta ?? {}),
      pageCount: parsed.pageCount,
      updatedAt: new Date(),
    })
    .where(eq(docCollectionDocument.id, doc.id));

  await refreshCollectionAggregates(doc.collectionId);
}

/**
 * Recompute the cached aggregates (docCount / totalPages / totalBytes) on the
 * collection from its current documents. Called after every doc add / delete /
 * parse-complete so the sidebar list always shows up-to-date stats.
 */
export async function refreshCollectionAggregates(collectionId: string) {
  const [agg] = await db()
    .select({
      docCount: sql<number>`count(*)`.as('doc_count'),
      totalPages:
        sql<number>`coalesce(sum(${docCollectionDocument.pageCount}), 0)`.as(
          'total_pages'
        ),
      totalBytes:
        sql<number>`coalesce(sum(${docCollectionDocument.fileBytes}), 0)`.as(
          'total_bytes'
        ),
    })
    .from(docCollectionDocument)
    .where(eq(docCollectionDocument.collectionId, collectionId));
  await db()
    .update(docCollection)
    .set({
      docCount: Number(agg?.docCount ?? 0),
      totalPages: Number(agg?.totalPages ?? 0),
      totalBytes: Number(agg?.totalBytes ?? 0),
      updatedAt: new Date(),
    })
    .where(eq(docCollection.id, collectionId));
}

export async function listDocuments(userId: string, collectionId: string) {
  // Defensive ownership check (paranoia — the route layer also enforces it).
  const owner = await getCollection(userId, collectionId);
  if (!owner) return [];
  return db()
    .select()
    .from(docCollectionDocument)
    .where(eq(docCollectionDocument.collectionId, collectionId))
    .orderBy(desc(docCollectionDocument.createdAt));
}

export async function getDocument(userId: string, id: string) {
  const [row] = await db()
    .select()
    .from(docCollectionDocument)
    .where(
      and(
        eq(docCollectionDocument.id, id),
        eq(docCollectionDocument.userId, userId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function deleteDocument(userId: string, id: string) {
  const result = await db()
    .delete(docCollectionDocument)
    .where(
      and(
        eq(docCollectionDocument.id, id),
        eq(docCollectionDocument.userId, userId)
      )
    )
    .returning();
  if (result.length > 0) {
    await refreshCollectionAggregates(result[0].collectionId);
  }
  return result.length > 0;
}

// ─── Ask (cross-document Q&A) ───────────────────────────────────────────────

interface BuildMessagesResult {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  sources: AskSource[];
  truncated: boolean;
}

/**
 * Stitch the parsed documents into a prompt. Returns the message list + the
 * "source catalog" (id + filename + page map) that the model can reference in
 * its reply.
 *
 * Truncation policy: if combined text would blow past 900k tokens (≈ 3.6MB
 * chars) we drop whole documents from the tail, then truncate the last kept
 * document, then surface `truncated: true` so the caller can warn the user.
 */
function buildAskMessages(
  question: string,
  docs: Array<{
    id: string;
    filename: string;
    contentText: string | null;
    contentMeta: string | null;
  }>,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): BuildMessagesResult {
  const sources: AskSource[] = [];
  const maxChars = 3_600_000; // ~900K tokens, comfortably under K3's 1M ceiling
  const budget = maxChars - question.length - 2000; // reserve room for prompt + history

  // Order docs by id so the prompt is deterministic across calls.
  const usable = docs.filter((d) => d.contentText && d.contentText.trim());

  const docBlocks: string[] = [];
  let used = 0;
  let truncated = false;

  for (const d of usable) {
    const header = `\n\n<<<DOC ${d.id} | ${d.filename}>>>\n`;
    const body = d.contentText ?? '';
    if (used + header.length + body.length > budget) {
      const remaining = budget - used - header.length;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      docBlocks.push(header + body.slice(0, remaining) + '\n<<<TRUNCATED>>>');
      truncated = true;
      break;
    }
    docBlocks.push(header + body);
    used += header.length + body.length;
  }

  const messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: h.role, content: h.content })),
  ];

  if (docBlocks.length === 0) {
    messages.push({
      role: 'user',
      content: `${question}\n\n[No documents have been parsed yet — ask the user to upload and wait for parsing to complete.]`,
    });
  } else {
    messages.push({
      role: 'user',
      content: buildAskPrompt({
        question,
        documentBlocks: docBlocks.join(''),
        truncated,
      }),
    });
  }

  // Build a flat source catalog for the model to cite against.
  for (const d of usable.slice(0, docBlocks.length)) {
    let pages: number | undefined;
    try {
      const meta = d.contentMeta ? JSON.parse(d.contentMeta) : null;
      pages = typeof meta?.pageCount === 'number' ? meta.pageCount : undefined;
    } catch {
      /* ignore */
    }
    sources.push({
      docId: d.id,
      filename: d.filename,
      page: pages,
      quote: '',
    });
  }

  return { messages, sources, truncated };
}

const CITATION_RE = /\[\[([a-zA-Z0-9_-]+)(?:\s*,\s*(\d+))?\]\]/g;

/**
 * Walk the streamed answer text, picking up every `[[docId, page]]` token the
 * model emits and resolving it against the source catalog to produce a
 * deduped `AskSource[]`. Called once at the end of the stream.
 */
function extractCitations(text: string, catalog: AskSource[]): AskSource[] {
  const seen = new Set<string>();
  const out: AskSource[] = [];
  for (const m of text.matchAll(CITATION_RE)) {
    const docId = m[1];
    const pageStr = m[2];
    if (seen.has(docId)) continue;
    seen.add(docId);
    const hit = catalog.find((s) => s.docId === docId);
    if (!hit) continue;
    out.push({
      docId,
      filename: hit.filename,
      page: pageStr ? Number(pageStr) : hit.page,
      quote: '',
    });
  }
  return out;
}

/**
 * Resolve the K3 model config — mirrors the playground / chat pattern so
 * admins only configure `evolink_api_key` (default model `kimi-k3`).
 */
async function resolveModelConfig() {
  const evolinkKey = (await getConfig('evolink_api_key')) || '';
  if (evolinkKey) {
    return {
      apiKey: evolinkKey,
      baseUrl:
        (await getConfig('evolink_base_url')) || 'https://api.evolink.ai/v1',
      model: (await getConfig('evolink_model')) || 'kimi-k3',
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
  return { apiKey, baseUrl, model, hasKey: !!apiKey };
}

export async function streamAsk(
  params: AskInput,
  signal?: AbortSignal
): Promise<AsyncGenerator<AskStreamEvent, void, unknown>> {
  // Lazy import to keep the module's top-level synchronous.
  const self = await import('./service');
  return self._streamAskImpl(params, signal);
}

async function* _streamAskImpl(
  params: AskInput,
  signal?: AbortSignal
): AsyncGenerator<AskStreamEvent, void, unknown> {
  // 1. Access gate: anonymous → login required, signed-in → consume credits.
  if (!(await consumeMessage(params.userId).then((r) => r.success))) {
    yield { type: 'error', message: 'payment_required' };
    return;
  }

  // 2. Pull collection + parsed documents.
  const coll = await getCollection(params.userId, params.collectionId);
  if (!coll) {
    yield { type: 'error', message: 'Collection not found' };
    return;
  }
  const docs = await listDocuments(params.userId, params.collectionId);
  const parsed = docs.filter(
    (d) => d.parseStatus === 'success' || d.parseStatus === 'truncated'
  );

  // 3. Persist the user message first (we never want a UI without a record).
  const userMsgId = getUuid();
  await db().insert(docCollectionMessage).values({
    id: userMsgId,
    collectionId: coll.id,
    userId: params.userId,
    role: 'user',
    content: params.question,
    citations: null,
    model: null,
  });

  // 4. Read recent history (last 10 turns) so the model has conversation
  //    context. The current question is appended in buildAskMessages.
  const recent = await db()
    .select()
    .from(docCollectionMessage)
    .where(eq(docCollectionMessage.collectionId, coll.id))
    .orderBy(desc(docCollectionMessage.createdAt))
    .limit(11);
  const history = recent
    .reverse()
    .filter((m) => m.id !== userMsgId)
    .slice(-10)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // 5. Build the prompt and resolve model.
  const { messages, sources, truncated } = buildAskMessages(
    params.question,
    parsed,
    history
  );
  const cfg = await resolveModelConfig();
  if (!cfg.hasKey) {
    yield {
      type: 'error',
      message:
        'No AI provider configured. Set evolink_api_key or openai_api_key.',
    };
    return;
  }

  // 6. Stream.
  let full = '';
  try {
    for await (const delta of openaiChatCompletionStream({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      messages,
      signal,
    })) {
      if (!delta) continue;
      full += delta;
      yield { type: 'delta', text: delta };
    }
  } catch (err: any) {
    if (signal?.aborted) return;
    yield { type: 'error', message: err?.message ?? 'Generation failed' };
    return;
  }

  // 7. Extract citations, persist, emit sources + done.
  const citations = extractCitations(full, sources);
  const assistantId = getUuid();
  await db()
    .insert(docCollectionMessage)
    .values({
      id: assistantId,
      collectionId: coll.id,
      userId: params.userId,
      role: 'assistant',
      content: full,
      citations: citations.length ? JSON.stringify(citations) : null,
      model: cfg.model,
    });
  await db()
    .update(docCollection)
    .set({ updatedAt: new Date() })
    .where(eq(docCollection.id, coll.id));

  if (truncated) {
    yield {
      type: 'delta',
      text: '\n\n_(Some documents were truncated to fit the context window — answer is based on the first portion only.)_',
    };
  }
  if (citations.length) {
    yield { type: 'sources', sources: citations };
  }
  yield { type: 'done' };
}

export async function listMessages(
  userId: string,
  collectionId: string,
  limit = 200
) {
  const owner = await getCollection(userId, collectionId);
  if (!owner) return null;
  return db()
    .select()
    .from(docCollectionMessage)
    .where(eq(docCollectionMessage.collectionId, collectionId))
    .orderBy(desc(docCollectionMessage.createdAt))
    .limit(limit);
}

export async function deleteAllMessages(userId: string, collectionId: string) {
  const owner = await getCollection(userId, collectionId);
  if (!owner) return false;
  await db()
    .delete(docCollectionMessage)
    .where(eq(docCollectionMessage.collectionId, collectionId));
  return true;
}

// ─── Bulk helper ─────────────────────────────────────────────────────────────

export async function bulkDeleteDocuments(
  userId: string,
  ids: string[]
): Promise<number> {
  if (!ids.length) return 0;
  // Ownership check via IN clause scoped to user.
  const owned = await db()
    .select({ id: docCollectionDocument.id })
    .from(docCollectionDocument)
    .where(
      and(
        inArray(docCollectionDocument.id, ids),
        eq(docCollectionDocument.userId, userId)
      )
    );
  const ownedIds = owned.map((r) => r.id);
  if (!ownedIds.length) return 0;

  // Aggregate by collection so we can refresh the parent stats once per
  // collection rather than per deleted row.
  const docs = await db()
    .select({ collectionId: docCollectionDocument.collectionId })
    .from(docCollectionDocument)
    .where(inArray(docCollectionDocument.id, ownedIds));
  await db()
    .delete(docCollectionDocument)
    .where(inArray(docCollectionDocument.id, ownedIds));
  const distinct = new Set(docs.map((d) => d.collectionId));
  for (const cid of distinct) {
    await refreshCollectionAggregates(cid);
  }
  return ownedIds.length;
}

// re-export for the route layer
export { respErr };
