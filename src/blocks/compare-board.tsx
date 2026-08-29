import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { ArrowUp, Plus, Square, X } from 'lucide-react';
import { toast } from 'sonner';

import { AbortedError, streamCompare } from '@/lib/chat-stream';
import { getUuid } from '@/lib/hash';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import {
  ChatModelPicker,
  SELECTABLE_CHAT_MODEL_IDS,
  type SelectableChatModelId,
} from '@/blocks/chat-model-picker';

import {
  ATTACHMENT_ACCEPT,
  AttachmentChips,
  ChatFileToolPicker,
  FileGenerationTurn,
  type AttachmentChipItem,
  type FileKind,
} from './chat-file-tools';
import { MessageBubble } from './chat-shared';

/**
 * Side-by-side model comparison (LORKA-style): N independent columns, each
 * with its own model; the shared composer below the board sends one question
 * to every column at once via `/api/playground/compare` (one SSE connection,
 * frames tagged by column index — which is also why the column structure is
 * locked while streaming).
 *
 * Nothing here is persisted: threads live in this hook's state only and are
 * dropped when the user exits compare mode.
 */

export const MAX_COMPARE_COLUMNS = 3;

interface CompareColumnModel {
  id: string;
  model: SelectableChatModelId;
}

interface CompareMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** In-flight assistant bubble (40ms-batched flush, like the chat page). */
  streaming?: boolean;
  /** Terminal failure for this turn (gate / stream error) — excluded from follow-up history. */
  error?: boolean;
  /** Display-only chips on the user bubble (sent to the server once, on this turn). */
  attachments?: AttachmentChipItem[];
}

interface CompareComposer {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** Active file-generation tool (PPT / Word / Excel) — routes the send. */
  fileTool: FileKind | null;
  onFileToolChange: (kind: FileKind | null) => void;
  /** Files picked from any column's "+" — shared draft, shared chips. */
  onFilesSelected: (files: FileList | null) => void;
  attachments: AttachmentChipItem[];
  onRemoveAttachment: (id: string) => void;
  /** Uploads in flight — the send waits (same rule as the chat composer). */
  uploading: boolean;
  /** A file generation started from this board is still rendering. */
  filePending: boolean;
}

/** One file-generation result, mirrored into every column's thread. */
type CompareFileTurn = ComponentProps<typeof FileGenerationTurn> & {
  id: string;
};

type GateStatus = 'login_required' | 'payment_required' | 'free_limit_reached';

function gateText(status: GateStatus): string {
  switch (status) {
    case 'login_required':
      return m['settings.chat.compare_gate_login']();
    case 'payment_required':
      return m['settings.chat.compare_gate_payment']();
    case 'free_limit_reached':
      return m['settings.chat.compare_gate_free']();
  }
}

/**
 * Turn a column's rendered thread into prompt history: only COMPLETED
 * user→assistant pairs (errored / empty turns are dropped so a failed turn
 * never leaks into the next question's context). Threads are strictly
 * user,assistant pairs by construction.
 */
function toTurns(msgs: CompareMsg[]): {
  role: 'user' | 'assistant';
  content: string;
}[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (let i = 0; i + 1 < msgs.length; i += 2) {
    const user = msgs[i];
    const assistant = msgs[i + 1];
    if (user.role !== 'user' || assistant.role !== 'assistant') continue;
    if (assistant.error || !assistant.content) continue;
    out.push(
      { role: 'user', content: user.content },
      { role: 'assistant', content: assistant.content }
    );
  }
  return out;
}

/** Second column default: the flagship Kimi K3 unless that's column one. */
function pickSecondModel(
  primary: SelectableChatModelId
): SelectableChatModelId {
  return primary === 'kimi-k3' ? 'claude-sonnet-5' : 'kimi-k3';
}

export function useCompareChat() {
  const [columns, setColumns] = useState<CompareColumnModel[]>([]);
  const [threads, setThreads] = useState<Record<string, CompareMsg[]>>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight fan-out if the board unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const begin = useCallback((primary: SelectableChatModelId) => {
    setColumns([
      { id: getUuid(), model: primary },
      { id: getUuid(), model: pickSecondModel(primary) },
    ]);
    setThreads({});
    setIsStreaming(false);
  }, []);

  const exit = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setColumns([]);
    setThreads({});
    setIsStreaming(false);
  }, []);

  const addColumn = useCallback(() => {
    setColumns((prev) => {
      if (prev.length >= MAX_COMPARE_COLUMNS) return prev;
      const used = new Set(prev.map((c) => c.model));
      const model =
        SELECTABLE_CHAT_MODEL_IDS.find((id) => !used.has(id)) ?? 'kimi-k3';
      return [...prev, { id: getUuid(), model }];
    });
  }, []);

  /** Structure is locked while a fan-out is open — frames route by index. */
  const removeColumn = useCallback(
    (id: string) => {
      if (isStreaming) return;
      setColumns((prev) => prev.filter((c) => c.id !== id));
      setThreads((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [isStreaming]
  );

  const setColumnModel = useCallback(
    (id: string, model: SelectableChatModelId) => {
      setColumns((prev) =>
        prev.map((c) => (c.id === id ? { ...c, model } : c))
      );
    },
    []
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const send = useCallback(
    async (content: string, attachmentChips?: AttachmentChipItem[]) => {
      const text = content.trim();
      if (!text || isStreaming || columns.length === 0) return;
      // Only fully-uploaded attachments make it onto the wire; the chips are
      // also kept on the user bubble (display only — follow-up turns don't
      // replay them, matching image semantics on the chat page).
      const chips = attachmentChips ?? [];
      const payload = chips
        .filter((a) => a.uploadStatus === 'done' && !a.url.startsWith('blob:'))
        .map((a) => ({
          type: a.type,
          url: a.url,
          key: a.key,
          filename: a.filename,
        }));

      // Snapshot: index-tagged SSE frames resolve against THIS array.
      const cols = columns;
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      const stamp = getUuid();
      const placeholders = new Map<
        string,
        { userId: string; assistantId: string }
      >();
      for (const col of cols) {
        placeholders.set(col.id, {
          userId: `${stamp}-u-${col.id}`,
          assistantId: `${stamp}-a-${col.id}`,
        });
      }

      setThreads((prev) => {
        const next = { ...prev };
        for (const col of cols) {
          const ph = placeholders.get(col.id)!;
          next[col.id] = [
            ...(next[col.id] ?? []),
            {
              id: ph.userId,
              role: 'user',
              content: text,
              ...(chips.length ? { attachments: chips } : {}),
            },
            {
              id: ph.assistantId,
              role: 'assistant',
              content: '',
              streaming: true,
            },
          ];
        }
        return next;
      });

      // Deltas can arrive many ×/s per column; flush each column's bubble on a
      // ~40ms cadence (same throttle as the persistent chat page).
      const acc = new Map<string, string>();
      const timers = new Map<string, ReturnType<typeof setTimeout>>();
      const flush = (colId: string) => {
        timers.delete(colId);
        const value = acc.get(colId);
        if (value === undefined) return;
        const ph = placeholders.get(colId)!;
        setThreads((prev) => ({
          ...prev,
          [colId]: (prev[colId] ?? []).map((b) =>
            b.id === ph.assistantId ? { ...b, content: value } : b
          ),
        }));
      };
      const scheduleFlush = (colId: string) => {
        if (timers.has(colId)) return;
        timers.set(
          colId,
          setTimeout(() => flush(colId), 40)
        );
      };

      const failColumn = (colId: string, message: string) => {
        const ph = placeholders.get(colId);
        if (!ph) return;
        setThreads((prev) => ({
          ...prev,
          [colId]: (prev[colId] ?? []).map((b) =>
            b.id === ph.assistantId
              ? { ...b, streaming: false, error: true, content: message }
              : b
          ),
        }));
      };

      // One toast per fan-out even when every column hits the same gate.
      let gateToasted = false;

      try {
        await streamCompare(
          {
            columns: cols.map((col) => ({
              model: col.model,
              messages: [
                ...toTurns(threads[col.id] ?? []),
                { role: 'user' as const, content: text },
              ],
            })),
            // One composer → one attachment set for every column.
            ...(payload.length ? { attachments: payload } : {}),
          },
          {
            signal: controller.signal,
            onDelta: (c, delta) => {
              const col = c === undefined ? undefined : cols[c];
              if (!col) return;
              acc.set(col.id, (acc.get(col.id) ?? '') + delta);
              scheduleFlush(col.id);
            },
            onGate: (c, status) => {
              const message = gateText(status);
              if (c === undefined) {
                for (const col of cols) failColumn(col.id, message);
              } else {
                const col = cols[c];
                if (col) failColumn(col.id, message);
              }
              if (!gateToasted) {
                gateToasted = true;
                toast.error(message);
              }
            },
            onError: (c, message) => {
              if (c === undefined) {
                for (const col of cols) failColumn(col.id, message);
              } else {
                const col = cols[c];
                if (col) failColumn(col.id, message);
              }
            },
          }
        );
      } catch (e) {
        // Keep whatever streamed before an abort; surface real errors once.
        if (!(e instanceof AbortedError)) {
          toast.error((e as Error)?.message || 'Failed to send message');
        }
      } finally {
        for (const t of timers.values()) clearTimeout(t);
        timers.clear();
        setThreads((prev) => {
          const next = { ...prev };
          for (const col of cols) {
            const ph = placeholders.get(col.id)!;
            const value = acc.get(col.id) ?? '';
            next[col.id] = (prev[col.id] ?? []).map((b) =>
              b.id === ph.assistantId
                ? { ...b, content: value || b.content, streaming: false }
                : b
            );
          }
          return next;
        });
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [columns, isStreaming, threads]
  );

  return {
    columns,
    threads,
    isStreaming,
    begin,
    exit,
    addColumn,
    removeColumn,
    setColumnModel,
    send,
    stop,
  };
}

export function CompareBoard({
  columns,
  threads,
  isStreaming,
  onAdd,
  onRemove,
  onSelectModel,
  composer,
  fileTurns,
}: {
  columns: CompareColumnModel[];
  threads: Record<string, CompareMsg[]>;
  isStreaming: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onSelectModel: (id: string, model: SelectableChatModelId) => void;
  /** When supplied, render a mirrored composer at the foot of each column. */
  composer?: CompareComposer;
  /** File-generation results, mirrored at the top of every column's thread. */
  fileTurns?: CompareFileTurn[];
}) {
  return (
    <div className="relative flex h-full min-h-0 w-full">
      <div className="scrollbar-none flex h-full w-full snap-x snap-mandatory overflow-x-auto">
        {columns.map((col, index) => (
          <div
            key={col.id}
            className={cn(
              'relative flex h-full min-w-0 shrink-0 grow basis-full snap-start flex-col',
              columns.length !== 1 && 'md:basis-1/2 lg:basis-1/3'
            )}
          >
            {columns.length !== 1 && index < columns.length - 1 && (
              <span
                aria-hidden="true"
                className="bg-foreground/10 pointer-events-none absolute inset-y-0 right-0 z-10 w-px"
              />
            )}
            <div
              className={cn(
                'flex h-full w-full min-w-0 flex-col',
                // Lone remaining column: become the whole board again —
                // a centered, chat-width conversation instead of a half-
                // width column stranded on the left. mx-auto does the
                // horizontal centering (the outer wrapper is flex-col,
                // so justify-center there would only center vertically).
                columns.length === 1 && 'mx-auto max-w-3xl'
              )}
            >
              <CompareColumn
                column={col}
                msgs={threads[col.id] ?? []}
                isStreaming={isStreaming}
                onRemove={onRemove}
                onSelectModel={onSelectModel}
                composer={composer}
                fileTurns={fileTurns}
              />
            </div>
          </div>
        ))}
      </div>

      {columns.length < MAX_COMPARE_COLUMNS && (
        <div className="pointer-events-none absolute inset-y-0 right-3 z-10 flex items-center">
          <button
            type="button"
            onClick={onAdd}
            disabled={isStreaming}
            aria-label={m['settings.chat.compare_add_column']()}
            title={m['settings.chat.compare_add_column']()}
            className="border-foreground/10 bg-background text-foreground/70 hover:bg-foreground/5 pointer-events-auto flex size-9 items-center justify-center rounded-full border shadow-sm transition-colors disabled:pointer-events-none disabled:opacity-40"
          >
            <Plus className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

const CompareColumn = memo(function CompareColumn({
  column,
  msgs,
  isStreaming,
  onRemove,
  onSelectModel,
  composer,
  fileTurns,
}: {
  column: CompareColumnModel;
  msgs: CompareMsg[];
  isStreaming: boolean;
  onRemove: (id: string) => void;
  onSelectModel: (id: string, model: SelectableChatModelId) => void;
  composer?: CompareComposer;
  fileTurns?: CompareFileTurn[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  // Last user bubble seen — a NEW one means a fresh turn just went out.
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // The reader may have scrolled up while reading a finished answer
    // (stick disengaged). A new prompt must re-engage follow mode so the
    // question and its stream scroll into view, mirroring the chat page's
    // `stickToBottomRef.current = true` on send.
    const lastUser = [...msgs].reverse().find((msg) => msg.role === 'user');
    if (lastUser && lastUser.id !== lastUserIdRef.current) {
      lastUserIdRef.current = lastUser.id;
      stickRef.current = true;
    }
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between px-2">
        {composer ? (
          // The picker lives beside this column's send button when the board
          // owns the composer. Keep this side of the header intentionally
          // quiet so it cannot be mistaken for a second model control.
          <span aria-hidden="true" className="size-7" />
        ) : (
          <ChatModelPicker
            selectedId={column.model}
            onSelect={(id) => onSelectModel(column.id, id)}
            disabled={isStreaming}
            placement="down"
          />
        )}
        <button
          type="button"
          onClick={() => onRemove(column.id)}
          disabled={isStreaming}
          aria-label={m['settings.chat.compare_remove_column']()}
          className="text-foreground/40 hover:text-foreground hover:bg-foreground/5 flex size-7 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-40"
        >
          <X className="size-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          stickRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="flex-1 overflow-y-auto px-3 py-4"
      >
        {msgs.length === 0 && !fileTurns?.length ? (
          <div className="text-foreground/45 flex h-full items-center justify-center px-6 text-center text-sm text-balance">
            {m['settings.chat.compare_empty_hint']()}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Generated files aren't per-model — the same artifact is
                mirrored into every column so any side can preview it. */}
            {fileTurns?.map((turn) => (
              <FileGenerationTurn
                key={turn.id}
                prompt={turn.prompt}
                kind={turn.kind}
                template={turn.template}
                artifact={turn.artifact}
                pending={turn.pending}
              />
            ))}
            {msgs.map((msg) =>
              msg.error ? (
                <div
                  key={msg.id}
                  className="text-destructive border-destructive/25 bg-destructive/10 mx-auto max-w-[92%] rounded-xl border px-3 py-2 text-center text-xs leading-relaxed"
                >
                  {msg.content}
                </div>
              ) : (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  streaming={msg.streaming}
                  compact
                />
              )
            )}
          </div>
        )}
      </div>
      {composer && (
        <CompareColumnComposer
          column={column}
          input={composer.input}
          onInputChange={composer.onInputChange}
          onSend={composer.onSend}
          onStop={composer.onStop}
          isStreaming={isStreaming}
          onSelectModel={onSelectModel}
          fileTool={composer.fileTool}
          onFileToolChange={composer.onFileToolChange}
          onFilesSelected={composer.onFilesSelected}
          attachments={composer.attachments}
          onRemoveAttachment={composer.onRemoveAttachment}
          uploading={composer.uploading}
          filePending={composer.filePending}
        />
      )}
    </div>
  );
});

/** One of the mirrored inputs at the bottom of the comparison columns. The
 * draft is deliberately shared by the board, so sending from either side
 * still asks the exact same question of every selected model — attachments
 * and the active file tool ride along on that same shared send. */
function CompareColumnComposer({
  column,
  input,
  onInputChange,
  onSend,
  onStop,
  isStreaming,
  onSelectModel,
  fileTool,
  onFileToolChange,
  onFilesSelected,
  attachments,
  onRemoveAttachment,
  uploading,
  filePending,
}: {
  column: CompareColumnModel;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  onSelectModel: (id: string, model: SelectableChatModelId) => void;
  fileTool: FileKind | null;
  onFileToolChange: (kind: FileKind | null) => void;
  onFilesSelected: (files: FileList | null) => void;
  attachments: AttachmentChipItem[];
  onRemoveAttachment: (id: string) => void;
  uploading: boolean;
  filePending: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // A file tool redirects the send to the generation flow, so its own
  // placeholder wins over the compare one.
  const placeholder = fileTool
    ? fileTool === 'pptx'
      ? m['file_studio.placeholder.pptx']()
      : fileTool === 'docx'
        ? m['file_studio.placeholder.docx']()
        : m['file_studio.placeholder.xlsx']()
    : m['settings.chat.compare_placeholder']();

  return (
    <div className="shrink-0 px-3 py-3">
      <div className="border-foreground/15 focus-within:border-foreground/30 dark:bg-foreground/[0.04] rounded-2xl border bg-white px-2 pt-2 pb-1.5 shadow-sm transition-colors">
        {/* Each mirrored composer owns its picker input; the picked files
            land in the board's shared attachment state. */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          onChange={(event) => {
            onFilesSelected(event.target.files);
            // Re-picking the same file must fire change again.
            event.target.value = '';
          }}
          className="hidden"
        />
        <AttachmentChips
          attachments={attachments}
          onRemove={onRemoveAttachment}
        />
        <textarea
          ref={taRef}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              onSend();
            }
          }}
          rows={1}
          placeholder={placeholder}
          className="placeholder:text-foreground/40 block max-h-32 min-h-[2.5rem] w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none"
        />
        <div className="flex items-center justify-between gap-1.5 pt-1">
          {/* Attach + file tools — same affordances as the single-column
              composer, so switching into compare mode keeps the workflow. */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              aria-label={m['playground.attachment.add']()}
              title={m['playground.attachment.add']()}
              className="text-foreground/55 hover:text-foreground hover:bg-foreground/5 flex size-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus className="size-[18px]" />
            </button>
            <ChatFileToolPicker
              value={fileTool}
              onChange={(kind) => {
                onFileToolChange(kind);
                if (kind) {
                  requestAnimationFrame(() => taRef.current?.focus());
                }
              }}
              disabled={isStreaming || filePending}
              compact
            />
          </div>
          <div className="flex items-center gap-1.5">
            <ChatModelPicker
              selectedId={column.model}
              onSelect={(id) => onSelectModel(column.id, id)}
              disabled={isStreaming}
              placement="up"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop"
                className="text-foreground/70 hover:bg-foreground/5 border-foreground/10 flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors"
              >
                <Square className="size-3.5" fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={!input.trim() || uploading}
                aria-label={m['settings.chat.send']()}
                className="bg-foreground text-background hover:bg-foreground/85 flex size-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
