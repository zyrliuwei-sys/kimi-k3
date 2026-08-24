import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type RefObject,
} from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp,
  Check,
  FileSpreadsheet,
  FileText,
  FolderPlus,
  LibraryBig,
  Loader2,
  MessageSquareText,
  Paperclip,
  Plus,
  Sparkles,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { z } from 'zod';

import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { uploadLibraryDocuments } from '@/lib/doc-library-client';
import { streamDocAsk, type DocSource } from '@/lib/doc-stream';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { TextField } from '@/components/form-field';
import { MarkdownContent } from '@/components/markdown-content';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

interface Collection {
  id: string;
  name: string;
  description: string;
  docCount: number;
  totalPages: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
}

interface LibraryDocument {
  id: string;
  collectionId: string;
  filename: string;
  storageUrl: string;
  mimeType: string;
  fileBytes: number;
  pageCount: number;
  parseStatus: string;
  parseError: string | null;
  createdAt: string;
}

interface LibraryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: string | null;
  createdAt: string;
}

interface PendingMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: DocSource[];
  streaming?: boolean;
}

const collectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const QUICK_QUESTIONS = [
  'doc_library.chat.quick_summary',
  'doc_library.chat.quick_compare',
  'doc_library.chat.quick_extract',
] as const;

function parseSources(citations: string | null): DocSource[] {
  if (!citations) return [];
  try {
    const value = JSON.parse(citations);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (source): source is DocSource =>
        source &&
        typeof source.docId === 'string' &&
        typeof source.filename === 'string'
    );
  } catch {
    return [];
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function parseLabel(status: string) {
  switch (status) {
    case 'pending':
      return m['doc_library.parse_pending']();
    case 'processing':
      return m['doc_library.parse_processing']();
    case 'truncated':
      return m['doc_library.parse_truncated']();
    case 'failed':
      return m['doc_library.parse_failed']();
    default:
      return m['doc_library.parse_success']();
  }
}

function documentIcon(mimeType: string) {
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
    return FileSpreadsheet;
  }
  return FileText;
}

/** A visible, source-first workspace for the existing long-context document API. */
export function DocumentLibrary() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const collectionsQuery = useQuery({
    queryKey: ['doc-library', 'collections'],
    queryFn: () => apiGet<Collection[]>('/api/doc-library/collection'),
  });
  const collections = collectionsQuery.data ?? [];
  const activeCollection = collections.find((item) => item.id === activeId);

  const documentsQuery = useQuery({
    queryKey: ['doc-library', 'documents', activeId],
    queryFn: () =>
      apiGet<LibraryDocument[]>(
        `/api/doc-library/document?collectionId=${encodeURIComponent(activeId!)}`
      ),
    enabled: Boolean(activeId),
  });
  const documents = documentsQuery.data ?? [];

  const messagesQuery = useQuery({
    queryKey: ['doc-library', 'messages', activeId],
    queryFn: () =>
      apiGet<LibraryMessage[]>(
        `/api/doc-library/messages?collectionId=${encodeURIComponent(activeId!)}`
      ),
    enabled: Boolean(activeId),
  });
  const messages = messagesQuery.data ?? [];

  useEffect(() => {
    if (!collections.length) {
      setActiveId(null);
      return;
    }
    if (!activeId || !collections.some((item) => item.id === activeId)) {
      setActiveId(collections[0].id);
    }
  }, [activeId, collections]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, pending]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const createForm = useForm({
    defaultValues: { name: '' },
    validators: { onSubmit: collectionSchema },
    onSubmit: async ({ value }) => {
      const collection = await apiPost<Collection>(
        '/api/doc-library/collection',
        value
      );
      await queryClient.invalidateQueries({
        queryKey: ['doc-library', 'collections'],
      });
      setActiveId(collection.id);
      setCreateOpen(false);
    },
  });

  useEffect(() => {
    if (!createOpen) createForm.reset();
  }, [createOpen, createForm]);

  const uploadMutation = useMutation({
    mutationFn: ({
      collectionId,
      files,
    }: {
      collectionId: string;
      files: File[];
    }) => uploadLibraryDocuments(collectionId, files),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['doc-library', 'documents', activeId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['doc-library', 'collections'],
        }),
      ]);
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/doc-library/document?id=${id}`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['doc-library', 'documents', activeId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['doc-library', 'collections'],
        }),
      ]);
    },
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/api/doc-library/collection?id=${id}`),
    onSuccess: async () => {
      setActiveId(null);
      setPending([]);
      await queryClient.invalidateQueries({
        queryKey: ['doc-library', 'collections'],
      });
    },
  });

  const acceptFiles = useCallback(
    (pickedFiles: File[]) => {
      if (!activeId || !pickedFiles.length || uploadMutation.isPending) return;
      uploadMutation.mutate({ collectionId: activeId, files: pickedFiles });
    },
    [activeId, uploadMutation]
  );

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    acceptFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  }

  function handleDeleteDocument(document: LibraryDocument) {
    if (!window.confirm(m['doc_library.delete_document_confirm']())) return;
    deleteDocumentMutation.mutate(document.id);
  }

  function handleDeleteCollection() {
    if (!activeId) return;
    if (!window.confirm(m['doc_library.delete_collection_confirm']())) return;
    deleteCollectionMutation.mutate(activeId);
  }

  async function askQuestion(questionText?: string) {
    const content = (questionText ?? question).trim();
    if (!activeId || !content || isStreaming) return;

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const userMessageId = `pending-user-${Date.now()}`;
    const assistantMessageId = `pending-assistant-${Date.now()}`;
    let receivedError = false;
    let completed = false;
    setQuestion('');
    setStreamError(null);
    setIsStreaming(true);
    setPending([
      { id: userMessageId, role: 'user', content },
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        sources: [],
        streaming: true,
      },
    ]);

    try {
      await streamDocAsk(
        { collectionId: activeId, question: content },
        {
          signal: controller.signal,
          onDelta: (text) => {
            setPending((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: message.content + text }
                  : message
              )
            );
          },
          onSources: (sources) => {
            setPending((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, sources }
                  : message
              )
            );
          },
          onDone: () => {
            completed = true;
          },
          onError: (message) => {
            receivedError = true;
            if (message === 'payment_required') {
              setStreamError(m['doc_library.error.payment_required']());
            } else if (message === 'login_required') {
              setStreamError(m['doc_library.error.unauthorized']());
            } else {
              setStreamError(m['doc_library.error.generic']());
            }
          },
        }
      );

      if (completed) {
        setPending([]);
        await queryClient.invalidateQueries({
          queryKey: ['doc-library', 'messages', activeId],
        });
      } else {
        setPending((current) =>
          current.map((message) => ({ ...message, streaming: false }))
        );
      }
    } catch (error) {
      if (!controller.signal.aborted && !receivedError) {
        setStreamError(
          error instanceof Error
            ? error.message
            : m['doc_library.error.generic']()
        );
      }
      setPending((current) =>
        current.map((message) => ({ ...message, streaming: false }))
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsStreaming(false);
    }
  }

  function openSource(source: DocSource) {
    const document = documents.find((item) => item.id === source.docId);
    if (!document?.storageUrl) return;
    const pageFragment = source.page ? `#page=${source.page}` : '';
    window.open(
      `${document.storageUrl}${pageFragment}`,
      '_blank',
      'noopener,noreferrer'
    );
  }

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-[radial-gradient(circle_at_50%_-20%,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_36rem)]">
      <div className="flex min-h-[calc(100dvh-3.5rem)]">
        <aside className="border-foreground/10 bg-background/55 hidden w-72 shrink-0 flex-col border-r backdrop-blur md:flex">
          <div className="border-foreground/10 border-b px-4 py-5">
            <div className="flex items-center gap-2">
              <span className="bg-primary/10 text-primary grid size-8 place-items-center rounded-lg">
                <LibraryBig className="size-4" />
              </span>
              <div>
                <h1 className="text-sm font-semibold">
                  {m['doc_library.title']()}
                </h1>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {m['doc_library.subtitle']()}
                </p>
              </div>
            </div>
            <Button className="mt-4 w-full" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {m['doc_library.new_collection']()}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-3">
            <p className="text-muted-foreground px-2 pb-2 text-[10px] font-semibold tracking-[0.16em] uppercase">
              {m['doc_library.sidebar.recent']()}
            </p>
            {collections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                onClick={() => {
                  setActiveId(collection.id);
                  setPending([]);
                  setStreamError(null);
                }}
                className={cn(
                  'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors',
                  collection.id === activeId
                    ? 'bg-primary/10 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                )}
              >
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-md',
                    collection.id === activeId
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  )}
                >
                  <FileText className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {collection.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] opacity-65">
                    {collection.docCount} · {collection.totalPages}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <MobileCollectionBar
            collections={collections}
            activeId={activeId}
            onSelect={(id) => {
              setActiveId(id);
              setPending([]);
              setStreamError(null);
            }}
            onCreate={() => setCreateOpen(true)}
          />

          {!activeCollection ? (
            <EmptyLibrary onCreate={() => setCreateOpen(true)} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <header className="border-foreground/10 bg-background/65 flex items-center justify-between gap-4 border-b px-4 py-3 backdrop-blur md:px-6">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold tracking-tight md:text-lg">
                    {activeCollection.name}
                  </h2>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {activeCollection.docCount} · {activeCollection.totalPages}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleDeleteCollection}
                  disabled={deleteCollectionMutation.isPending}
                  aria-label={m['doc_library.delete_collection_confirm']()}
                >
                  {deleteCollectionMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </header>

              <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_19rem]">
                <section className="flex min-h-[min(56dvh,42rem)] min-w-0 flex-col lg:min-h-0">
                  <div
                    ref={scrollRef}
                    className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8"
                  >
                    {messagesQuery.isLoading ? (
                      <div className="grid h-full min-h-48 place-items-center">
                        <Loader2 className="text-muted-foreground size-5 animate-spin" />
                      </div>
                    ) : messages.length === 0 && pending.length === 0 ? (
                      <ChatEmpty
                        onQuestion={(value) => void askQuestion(value)}
                      />
                    ) : (
                      <div className="mx-auto max-w-3xl space-y-6">
                        {messages.map((message) => (
                          <MessageBubble
                            key={message.id}
                            role={message.role}
                            content={message.content}
                            sources={parseSources(message.citations)}
                            onOpenSource={openSource}
                          />
                        ))}
                        {pending.map((message) => (
                          <MessageBubble
                            key={message.id}
                            role={message.role}
                            content={message.content}
                            sources={message.sources ?? []}
                            streaming={message.streaming}
                            onOpenSource={openSource}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-foreground/10 bg-background/75 border-t p-3 backdrop-blur md:px-6 md:py-4">
                    {streamError && (
                      <p className="text-destructive mb-2 text-xs">
                        {streamError}
                      </p>
                    )}
                    <div className="border-foreground/12 bg-card focus-within:ring-primary/20 rounded-xl border p-2 shadow-sm transition-shadow focus-within:ring-3">
                      <Textarea
                        value={question}
                        onChange={(event) => setQuestion(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            void askQuestion();
                          }
                        }}
                        placeholder={m['doc_library.chat.placeholder']()}
                        disabled={isStreaming}
                        className="min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                      />
                      <div className="flex items-center justify-between gap-2 px-1 pt-1">
                        <span className="text-muted-foreground hidden items-center gap-1 text-[11px] sm:flex">
                          <Sparkles className="size-3" />
                          {m['doc_library.chat.empty']()}
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          {isStreaming && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => abortRef.current?.abort()}
                            >
                              <X className="size-3.5" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            onClick={() => void askQuestion()}
                            disabled={!question.trim() || isStreaming}
                            aria-label={m['doc_library.chat.tab']()}
                          >
                            {isStreaming ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <ArrowUp className="size-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <DocumentPanel
                  documents={documents}
                  isLoading={documentsQuery.isLoading}
                  uploading={uploadMutation.isPending}
                  uploadFailed={uploadMutation.isError}
                  dragging={isDragging}
                  inputRef={fileInputRef}
                  onOpenPicker={() => fileInputRef.current?.click()}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragging(false);
                    acceptFiles(Array.from(event.dataTransfer.files));
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onInput={handleFileInput}
                  onDelete={handleDeleteDocument}
                  deletingId={deleteDocumentMutation.variables}
                />
              </div>
            </div>
          )}
        </main>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m['doc_library.new_collection']()}</DialogTitle>
            <DialogDescription>
              {m['doc_library.no_collections_hint']()}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createForm.handleSubmit().catch(() => undefined);
            }}
          >
            <createForm.Field name="name">
              {(field) => (
                <TextField
                  field={field}
                  label={m['doc_library.new_collection']()}
                  placeholder={m['doc_library.collection_name_placeholder']()}
                  required
                />
              )}
            </createForm.Field>
            <DialogFooter className="mt-5">
              <createForm.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <FolderPlus className="size-4" />
                    )}
                    {m['doc_library.new_collection']()}
                  </Button>
                )}
              </createForm.Subscribe>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MobileCollectionBar({
  collections,
  activeId,
  onSelect,
  onCreate,
}: {
  collections: Collection[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="border-foreground/10 flex items-center gap-2 overflow-x-auto border-b px-3 py-2 md:hidden">
      <Button
        size="icon-sm"
        variant="outline"
        onClick={onCreate}
        aria-label={m['doc_library.new_collection']()}
      >
        <Plus className="size-4" />
      </Button>
      {collections.map((collection) => (
        <button
          key={collection.id}
          type="button"
          onClick={() => onSelect(collection.id)}
          className={cn(
            'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium',
            activeId === collection.id
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {collection.name}
        </button>
      ))}
    </div>
  );
}

function EmptyLibrary({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-5">
      <div className="max-w-xl text-center">
        <span className="bg-primary/10 text-primary mx-auto grid size-14 place-items-center rounded-2xl">
          <LibraryBig className="size-6" />
        </span>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight">
          {m['doc_library.hero.heading']()}
        </h2>
        <p className="text-muted-foreground mx-auto mt-3 max-w-lg text-sm leading-6">
          {m['doc_library.hero.subheading']()}
        </p>
        <div className="mt-7 grid gap-2 text-left sm:grid-cols-2">
          <Capability
            icon={Sparkles}
            title={m['doc_library.capability.context.title']()}
            description={m['doc_library.capability.context.desc']()}
          />
          <Capability
            icon={Check}
            title={m['doc_library.capability.cited.title']()}
            description={m['doc_library.capability.cited.desc']()}
          />
          <Capability
            icon={MessageSquareText}
            title={m['doc_library.capability.cross.title']()}
            description={m['doc_library.capability.cross.desc']()}
          />
          <Capability
            icon={FileText}
            title={m['doc_library.capability.multilang.title']()}
            description={m['doc_library.capability.multilang.desc']()}
          />
        </div>
        <Button size="lg" className="mt-7" onClick={onCreate}>
          <Plus className="size-4" />
          {m['doc_library.empty.cta']()}
        </Button>
      </div>
    </div>
  );
}

function Capability({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="border-foreground/10 bg-card/70 rounded-xl border p-3">
      <Icon className="text-primary size-4" />
      <p className="mt-2 text-sm font-medium">{title}</p>
      <p className="text-muted-foreground mt-0.5 text-xs leading-5">
        {description}
      </p>
    </div>
  );
}

function ChatEmpty({ onQuestion }: { onQuestion: (question: string) => void }) {
  return (
    <div className="mx-auto flex min-h-[30rem] max-w-2xl flex-col justify-center text-center">
      <span className="bg-primary/10 text-primary mx-auto grid size-11 place-items-center rounded-xl">
        <MessageSquareText className="size-5" />
      </span>
      <h3 className="mt-4 text-lg font-semibold">
        {m['doc_library.chat.tab']()}
      </h3>
      <p className="text-muted-foreground mt-1 text-sm">
        {m['doc_library.chat.empty']()}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {QUICK_QUESTIONS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onQuestion(m[key]())}
            className="border-foreground/10 bg-card hover:border-primary/35 inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs transition-colors"
          >
            <Sparkles className="text-primary size-3" />
            {m[key]()}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  sources,
  streaming,
  onOpenSource,
}: {
  role: 'user' | 'assistant';
  content: string;
  sources: DocSource[];
  streaming?: boolean;
  onOpenSource: (source: DocSource) => void;
}) {
  if (role === 'user') {
    return (
      <div className="bg-primary text-primary-foreground ml-auto max-w-[88%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-6 sm:max-w-[72%]">
        {content}
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-xs font-medium">
        <span className="bg-primary/10 text-primary grid size-6 place-items-center rounded-md">
          <Sparkles className="size-3.5" />
        </span>
      </div>
      <div className="prose prose-sm dark:prose-invert mt-2 max-w-none text-sm leading-7">
        {content ? (
          <MarkdownContent content={content} />
        ) : streaming ? (
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        ) : null}
      </div>
      <Sources sources={sources} onOpen={onOpenSource} />
    </div>
  );
}

function Sources({
  sources,
  onOpen,
}: {
  sources: DocSource[];
  onOpen: (source: DocSource) => void;
}) {
  if (!sources.length) return null;
  return (
    <div className="border-primary/25 mt-4 border-l-2 pl-3">
      <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.15em] uppercase">
        {m['doc_library.sources.label']()}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sources.map((source) => (
          <button
            key={`${source.docId}-${source.page ?? ''}`}
            type="button"
            onClick={() => onOpen(source)}
            className="border-foreground/10 bg-muted/60 hover:bg-muted inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors"
          >
            <FileText className="text-primary size-3 shrink-0" />
            <span className="max-w-40 truncate">{source.filename}</span>
            {source.page ? (
              <span className="text-muted-foreground">
                {m['doc_library.sources.page']()}
                {source.page}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function DocumentPanel({
  documents,
  isLoading,
  uploading,
  uploadFailed,
  dragging,
  inputRef,
  onOpenPicker,
  onDrop,
  onDragOver,
  onDragLeave,
  onInput,
  onDelete,
  deletingId,
}: {
  documents: LibraryDocument[];
  isLoading: boolean;
  uploading: boolean;
  uploadFailed: boolean;
  dragging: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onOpenPicker: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onDelete: (document: LibraryDocument) => void;
  deletingId?: string;
}) {
  return (
    <aside className="border-foreground/10 bg-muted/20 border-t p-4 lg:border-t-0 lg:border-l lg:p-5">
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.pages,.numbers,.txt,.md,.csv"
        onChange={onInput}
      />
      <div
        role="button"
        tabIndex={0}
        onClick={onOpenPicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenPicker();
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={cn(
          'flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-4 text-center transition-colors',
          dragging
            ? 'border-primary bg-primary/8'
            : 'border-foreground/15 bg-background/60 hover:border-primary/50'
        )}
      >
        {uploading ? (
          <Loader2 className="text-primary size-5 animate-spin" />
        ) : (
          <Paperclip className="text-primary size-5" />
        )}
        <p className="mt-2 text-sm font-medium">
          {uploading
            ? m['doc_library.uploading']()
            : m['doc_library.drop_files']()}
        </p>
        <p className="text-muted-foreground mt-1 text-xs leading-5">
          {m['doc_library.drop_files_hint']()}
        </p>
      </div>
      {uploadFailed && (
        <p className="text-destructive mt-2 text-xs">
          {m['doc_library.error.generic']()}
        </p>
      )}

      <div className="mt-5">
        {isLoading ? (
          <div className="grid h-20 place-items-center">
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          </div>
        ) : documents.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs leading-5">
            {m['doc_library.no_documents_hint']()}
          </p>
        ) : (
          <div className="space-y-2">
            {documents.map((document) => {
              const Icon = documentIcon(document.mimeType);
              const failed = document.parseStatus === 'failed';
              const ready =
                document.parseStatus === 'success' ||
                document.parseStatus === 'truncated';
              return (
                <div
                  key={document.id}
                  className="border-foreground/10 bg-background/70 group flex items-start gap-2.5 rounded-lg border p-2.5"
                >
                  <span className="bg-muted grid size-8 shrink-0 place-items-center rounded-md">
                    <Icon className="text-muted-foreground size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {document.filename}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[10px]">
                      {formatBytes(document.fileBytes)}
                      {document.pageCount ? ` · ${document.pageCount}` : ''}
                    </p>
                    <Badge
                      variant={
                        failed ? 'destructive' : ready ? 'secondary' : 'outline'
                      }
                      className="mt-1.5 h-5 px-1.5 text-[10px]"
                    >
                      {document.parseStatus === 'processing' ? (
                        <Loader2 className="size-2.5 animate-spin" />
                      ) : null}
                      {parseLabel(document.parseStatus)}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(document);
                    }}
                    disabled={deletingId === document.id}
                    aria-label={m['doc_library.delete_document_confirm']()}
                  >
                    {deletingId === document.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Trash2 className="size-3" />
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
