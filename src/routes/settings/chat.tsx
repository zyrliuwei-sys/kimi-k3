import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  ArrowUp,
  Columns2,
  MessageSquarePlus,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import {
  ChatModelPicker,
  type SelectableChatModelId,
} from '@/blocks/chat-model-picker';
import { MessageBubble } from '@/blocks/chat-shared';
import { CompareBoard, useCompareChat } from '@/blocks/compare-board';

interface ChatItem {
  id: string;
  title: string;
  model?: SelectableChatModelId;
  updatedAt: string;
}
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/** A locally-rendered bubble for the in-flight turn (not yet in the cache). */
interface PendingBubble {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

/** Pull a `{code,message}` envelope's message out of a JSON error body. */
function extractApiMessage(text: string): string {
  try {
    const json = JSON.parse(text);
    return typeof json?.message === 'string' ? json.message : '';
  } catch {
    return '';
  }
}

/** Parse one SSE frame (`data: {...}`) into its JSON payload, or null. */
function parseSSEFrame(
  frame: string
): { type: string; [k: string]: unknown } | null {
  for (const line of frame.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      return JSON.parse(payload);
    } catch {
      // keepalive / partial chunk — ignore
    }
  }
  return null;
}

function ChatPage() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<PendingBubble[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [modelId, setModelId] = useState<SelectableChatModelId>('kimi-k3');
  const [compareMode, setCompareMode] = useState(false);
  const compare = useCompareChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const chatsQuery = useQuery({
    queryKey: ['chats'],
    queryFn: () => apiGet<{ chats: ChatItem[] }>('/api/chat'),
  });

  const messagesQuery = useQuery({
    queryKey: ['chat', activeId],
    queryFn: () =>
      apiGet<{ chat: ChatItem; messages: Message[] }>(`/api/chat/${activeId}`),
    enabled: !!activeId,
  });

  const messages = messagesQuery.data?.messages ?? [];

  useEffect(() => {
    const model = messagesQuery.data?.chat.model;
    if (model) setModelId(model);
  }, [messagesQuery.data?.chat.model]);

  useEffect(() => {
    // Auto-select the most recent chat on first load.
    if (!activeId && chatsQuery.data?.chats?.length) {
      const newest = [...chatsQuery.data.chats].pop();
      if (newest) setActiveId(newest.id);
    }
  }, [chatsQuery.data, activeId]);

  // Stick-to-bottom auto-scroll: only autoscroll when the user is already near
  // the bottom, and use instant (not smooth) scroll so the rapid updates during
  // streaming don't queue smooth-scroll animations and stutter the main thread.
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, pending, scrollToBottom]);

  // Abort any in-flight stream if the component unloads.
  useEffect(() => () => abortRef.current?.abort(), []);

  const newChatMutation = useMutation({
    mutationFn: (model: SelectableChatModelId) =>
      apiPost<{ chat: ChatItem }>('/api/chat', { model }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setActiveId(data.chat.id);
      setInput('');
      setPending([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const streamSend = useCallback(
    async (id: string, content: string, model: SelectableChatModelId) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      stickToBottomRef.current = true;

      const userId = `pending-user-${id}`;
      const aiId = `pending-ai-${id}`;
      const acc = { current: '' }; // full assistant text accumulated so far

      // Throttle React state updates: deltas can arrive many ×/s, but we only
      // flush to state on a ~40ms cadence. This keeps the main thread idle
      // between paints and is the single biggest fix for streaming "卡顿".
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        flushTimer = null;
        setPending((prev) =>
          prev.map((b) => (b.id === aiId ? { ...b, content: acc.current } : b))
        );
      };
      const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(flush, 40);
      };

      setPending([
        { id: userId, role: 'user', content },
        { id: aiId, role: 'assistant', content: '', streaming: true },
      ]);

      try {
        const res = await fetch(`/api/chat/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, model }),
          signal: controller.signal,
        });

        // Pre-stream rejections (auth / validation) come back as a JSON error
        // envelope at HTTP 200 — detect via content-type, not res.ok.
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('text/event-stream')) {
          const text = await res.text().catch(() => '');
          throw new Error(
            extractApiMessage(text) || `Request failed (${res.status})`
          );
        }
        if (!res.body) throw new Error('Streaming unsupported by server');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let doneUser: Message | null = null;
        let doneAssistant: Message | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const event = parseSSEFrame(frame);
            if (!event) continue;
            if (event.type === 'delta' && typeof event.text === 'string') {
              acc.current += event.text as string;
              scheduleFlush();
            } else if (event.type === 'done') {
              doneUser = event.userMessage as Message;
              doneAssistant = event.assistantMessage as Message;
            } else if (event.type === 'error') {
              throw new Error((event.message as string) || 'Stream error');
            }
          }
        }

        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }

        if (doneUser && doneAssistant) {
          // Commit the canonical pair straight into the cache (no refetch
          // flash), then drop the local pending bubbles.
          queryClient.setQueryData<{ chat: ChatItem; messages: Message[] }>(
            ['chat', id],
            (old) =>
              old
                ? {
                    ...old,
                    messages: [...old.messages, doneUser!, doneAssistant!],
                  }
                : old
          );
          setPending([]);
          queryClient.invalidateQueries({ queryKey: ['chats'] });
        } else {
          flush(); // best-effort: keep whatever streamed even without a done frame
        }
      } catch (err: any) {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        setPending([]);
        if (!controller.signal.aborted) {
          toast.error(err?.message || 'Failed to send message');
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [queryClient]
  );

  async function handleSend() {
    const content = input.trim();
    if (!content) return;

    // Compare mode: fan the question out to every column via the shared
    // stateless endpoint — no chat is created, nothing is persisted.
    if (compareMode) {
      if (compare.isStreaming) return;
      setInput('');
      compare.send(content);
      return;
    }

    if (isStreaming) return;
    let id = activeId;
    if (!id) {
      const created = await newChatMutation.mutateAsync(modelId);
      id = created.chat.id;
    }
    setInput('');
    stickToBottomRef.current = true;
    streamSend(id!, content, modelId);
  }

  function handleStop() {
    if (compareMode) {
      compare.stop();
      return;
    }
    abortRef.current?.abort();
  }

  function toggleCompareMode() {
    if (compareMode) {
      compare.exit();
      setCompareMode(false);
      return;
    }
    // Entering mid-stream would orphan the pending bubbles — wait it out.
    if (isStreaming) return;
    compare.begin(modelId);
    setCompareMode(true);
  }

  // Closing the last remaining column would leave an empty board — treat it
  // as exiting compare mode (back to the normal single-column chat).
  function handleRemoveColumn(id: string) {
    if (compare.columns.length <= 1) {
      compare.exit();
      setCompareMode(false);
      return;
    }
    compare.removeColumn(id);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const chats = [...(chatsQuery.data?.chats ?? [])].reverse();
  const showEmpty = messages.length === 0 && pending.length === 0;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)]">
      {/* Conversation sidebar — hidden in compare mode (the columns need the
          width, and compare threads are ephemeral anyway) */}
      {!compareMode && (
        <aside className="border-foreground/10 bg-muted/30 hidden w-72 shrink-0 flex-col border-r md:flex">
          <div className="p-3">
            <button
              onClick={() => newChatMutation.mutate(modelId)}
              disabled={newChatMutation.isPending}
              className="bg-foreground text-background hover:bg-foreground/85 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
            >
              <MessageSquarePlus className="size-4" />
              {m['settings.chat.new_chat']()}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {chats.length > 0 &&
              chats.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                    c.id === activeId
                      ? 'bg-card font-medium shadow-sm'
                      : 'hover:bg-card/60'
                  )}
                >
                  <button
                    className="flex-1 truncate text-left"
                    onClick={() => setActiveId(c.id)}
                  >
                    {c.title?.trim() || m['settings.chat.untitled']()}
                  </button>
                  <DeleteChatButton
                    chatId={c.id}
                    onDeleted={(deletedId) => {
                      if (deletedId === activeId) setActiveId(null);
                    }}
                  />
                </div>
              ))}
          </div>
        </aside>
      )}

      {/* Thread / compare board */}
      <section className="flex min-w-0 flex-1 flex-col">
        {compareMode ? (
          <div className="min-h-0 flex-1">
            <CompareBoard
              columns={compare.columns}
              threads={compare.threads}
              isStreaming={compare.isStreaming}
              onAdd={compare.addColumn}
              onRemove={handleRemoveColumn}
              onSelectModel={compare.setColumnModel}
            />
          </div>
        ) : (
          <div
            ref={scrollRef}
            onScroll={() => {
              const el = scrollRef.current;
              if (!el) return;
              stickToBottomRef.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="flex-1 overflow-y-auto"
          >
            {showEmpty ? (
              <EmptyState
                onPick={(prompt) => {
                  setInput(prompt);
                }}
                disabled={!activeId}
              />
            ) : (
              <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {pending.map((b) => (
                  <MessageBubble
                    key={b.id}
                    message={b}
                    streaming={b.streaming}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Composer */}
        <div className="border-foreground/10 bg-background/80 border-t px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-3xl">
            <div className="bg-card focus-within:border-foreground/25 border-foreground/10 flex flex-col gap-1 rounded-2xl border p-2 shadow-sm">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={
                  compareMode
                    ? m['settings.chat.compare_placeholder']()
                    : m['settings.chat.placeholder']()
                }
                className="placeholder:text-foreground/40 max-h-40 min-h-[2.5rem] w-full resize-none bg-transparent px-2 py-2 text-[15px] outline-none"
              />
              {/* Bottom toolbar: compare entry/exit at the far left, hint in
                  the middle, model picker + send on the right. In compare
                  mode the leftmost button becomes the exit button. */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleCompareMode}
                  disabled={!compareMode && isStreaming}
                  aria-label={
                    compareMode
                      ? m['settings.chat.compare_exit']()
                      : m['settings.chat.compare_toggle']()
                  }
                  title={
                    compareMode
                      ? m['settings.chat.compare_exit']()
                      : m['settings.chat.compare_toggle']()
                  }
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
                    compareMode
                      ? 'bg-foreground text-background'
                      : 'text-foreground/55 hover:bg-foreground/5 hover:text-foreground'
                  )}
                >
                  <Columns2 className="size-4" />
                </button>
                <p className="text-foreground/35 min-w-0 flex-1 truncate text-[11px]">
                  {compareMode
                    ? m['settings.chat.compare_billing_hint']({
                        count: compare.columns.length,
                      })
                    : m['settings.chat.disclaimer']()}
                </p>
                {!compareMode && (
                  <ChatModelPicker
                    selectedId={modelId}
                    onSelect={setModelId}
                    disabled={isStreaming}
                  />
                )}
                {(compareMode ? compare.isStreaming : isStreaming) ? (
                  <button
                    onClick={handleStop}
                    aria-label="Stop"
                    className="text-foreground/70 hover:bg-foreground/5 border-foreground/10 flex size-8 shrink-0 items-center justify-center rounded-xl border transition-colors"
                  >
                    <Square className="size-4" fill="currentColor" />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim()}
                    aria-label={m['settings.chat.send']()}
                    className="border-foreground/10 bg-foreground/[0.05] text-foreground/75 hover:bg-foreground/[0.09] hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-40"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function EmptyState({
  onPick,
  disabled,
}: {
  onPick: (prompt: string) => void;
  disabled: boolean;
}) {
  const examples: string[] = m['settings.chat.examples']()
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-4 text-center">
      <div className="brand-gradient mb-5 flex size-14 items-center justify-center rounded-2xl">
        <Sparkles className="size-7 text-white" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">
        {m['settings.chat.welcome_title']()}
      </h2>
      <p className="text-foreground/55 mt-2 max-w-md">
        {m['settings.chat.welcome_desc']()}
      </p>
      <div className="mt-8 grid w-full gap-2.5 sm:grid-cols-2">
        {examples.map((ex) => (
          <button
            key={ex}
            disabled={disabled}
            onClick={() => onPick(ex)}
            className="bg-card hover:border-foreground/20 border-foreground/10 text-foreground/70 rounded-xl border px-4 py-3 text-left text-sm transition-colors disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function DeleteChatButton({
  chatId,
  onDeleted,
}: {
  chatId: string;
  onDeleted: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => apiDelete(`/api/chat/${chatId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.removeQueries({ queryKey: ['chat', chatId] });
      onDeleted(chatId);
    },
  });

  return (
    <button
      aria-label={m['settings.chat.delete']()}
      onClick={(e) => {
        e.stopPropagation();
        mutation.mutate();
      }}
      className="text-muted-foreground hover:text-destructive -mr-1 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

export const Route = createFileRoute('/settings/chat')({
  component: ChatPage,
});
