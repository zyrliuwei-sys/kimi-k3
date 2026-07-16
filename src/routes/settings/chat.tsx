import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ArrowUp, MessageSquarePlus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { MarkdownContent } from '@/components/markdown-content';

interface ChatItem {
  id: string;
  title: string;
  updatedAt: string;
}
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

function ChatPage() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    // Auto-select the most recent chat on first load.
    if (!activeId && chatsQuery.data?.chats?.length) {
      const newest = [...chatsQuery.data.chats].pop();
      if (newest) setActiveId(newest.id);
    }
  }, [chatsQuery.data, activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length, isThinking]);

  const newChatMutation = useMutation({
    mutationFn: () => apiPost<{ chat: ChatItem }>('/api/chat', {}),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setActiveId(data.chat.id);
      setInput('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: (vars: { id: string; content: string }) =>
      apiPost<{
        userMessage: Message;
        assistantMessage: Message;
      }>(`/api/chat/${vars.id}`, { content: vars.content }),
    onMutate: async (vars) => {
      const temp: Message = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: vars.content,
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueryData<{ chat: ChatItem; messages: Message[] }>(
        ['chat', vars.id],
        (old) => (old ? { ...old, messages: [...old.messages, temp] } : old)
      );
      setIsThinking(true);
    },
    onSuccess: (data, vars) => {
      queryClient.setQueryData<{ chat: ChatItem; messages: Message[] }>(
        ['chat', vars.id],
        (old) => {
          if (!old) return old;
          const withoutTemp = old.messages.filter(
            (msg) =>
              !(msg.id.startsWith('temp-') && msg.content === vars.content)
          );
          return {
            ...old,
            chat: {
              ...old.chat,
              title: data.userMessage ? old.chat.title : old.chat.title,
            },
            messages: [...withoutTemp, data.userMessage, data.assistantMessage],
          };
        }
      );
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setIsThinking(false);
    },
    onError: (e: Error, vars) => {
      queryClient.setQueryData<{ chat: ChatItem; messages: Message[] }>(
        ['chat', vars.id],
        (old) =>
          old
            ? {
                ...old,
                messages: old.messages.filter(
                  (msg) => !msg.id.startsWith('temp-')
                ),
              }
            : old
      );
      setIsThinking(false);
      toast.error(e.message);
    },
  });

  async function handleSend() {
    const content = input.trim();
    if (!content || sendMutation.isPending) return;

    let id = activeId;
    if (!id) {
      const created = await newChatMutation.mutateAsync();
      id = created.chat.id;
    }
    setInput('');
    sendMutation.mutate({ id: id!, content });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const chats = [...(chatsQuery.data?.chats ?? [])].reverse();

  return (
    <div className="flex h-[calc(100dvh-3.5rem)]">
      {/* Conversation sidebar */}
      <aside className="border-foreground/10 bg-muted/30 hidden w-72 shrink-0 flex-col border-r md:flex">
        <div className="p-3">
          <button
            onClick={() => newChatMutation.mutate()}
            disabled={newChatMutation.isPending}
            className="bg-foreground text-background hover:bg-foreground/85 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
          >
            <MessageSquarePlus className="size-4" />
            {m['settings.chat.new_chat']()}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {chats.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-xs">
              {m['settings.chat.no_chats']()}
            </p>
          ) : (
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
            ))
          )}
        </div>
      </aside>

      {/* Thread */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 && !isThinking ? (
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
              {isThinking && <ThinkingBubble />}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-foreground/10 bg-background/80 border-t px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-3xl">
            <div className="bg-card focus-within:border-foreground/25 border-foreground/10 flex items-end gap-2 rounded-2xl border p-2 shadow-sm">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={m['settings.chat.placeholder']()}
                className="placeholder:text-foreground/40 max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-3 py-2 text-[15px] outline-none"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sendMutation.isPending}
                aria-label={m['settings.chat.send']()}
                className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-xl text-white transition-opacity disabled:opacity-40"
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
            <p className="text-foreground/35 mt-2 text-center text-[11px]">
              {m['settings.chat.disclaimer']()}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
          isUser ? 'bg-foreground text-background' : 'brand-gradient text-white'
        )}
      >
        {isUser ? (
          m['settings.chat.you_initial']()
        ) : (
          <Sparkles className="size-3.5" />
        )}
      </div>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
          isUser
            ? 'bg-foreground text-background rounded-tr-md'
            : 'bg-card text-foreground border-foreground/10 rounded-tl-md border shadow-sm'
        )}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : (
          <MarkdownContent content={message.content} />
        )}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex gap-3">
      <div className="brand-gradient mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg">
        <Sparkles className="size-3.5 text-white" />
      </div>
      <div className="bg-card border-foreground/10 flex items-center gap-1.5 rounded-2xl rounded-tl-md border px-4 py-3 shadow-sm">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="bg-foreground/40 size-2 animate-bounce rounded-full"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
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
