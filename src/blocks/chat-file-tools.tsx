import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Loader2,
  Presentation,
  Table2,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export type FileKind = 'pptx' | 'docx' | 'xlsx';
export type FileTemplate = 'business' | 'modern' | 'minimal' | 'creative';

const GENERATION_PREVIEW_IMAGES: Record<FileKind, string> = {
  docx: '/imgs/generated/file-generation-document-1787980672654.png',
  pptx: '/imgs/generated/file-generation-presentation-1787980697062.png',
  xlsx: '/imgs/generated/file-generation-spreadsheet-1787980735154.png',
};

export interface FileArtifact {
  fileName: string;
  mimeType: string;
  base64: string;
  mode: 'ai' | 'draft';
  template: FileTemplate;
  preview: {
    kind: FileKind;
    title: string;
    subtitle?: string;
    slides?: Array<{ title: string; body: string[] }>;
    sections?: Array<{ heading: string; paragraphs: string[] }>;
    columns?: string[];
    rows?: Array<Array<string | number>>;
  };
}

interface ToolOption {
  kind: FileKind;
  label: string;
  compactLabel: string;
  icon: typeof Presentation;
}

function getTools(): ToolOption[] {
  return [
    {
      kind: 'pptx',
      label: m['file_studio.tool.pptx'](),
      compactLabel: m['file_studio.tool.pptx_short'](),
      icon: Presentation,
    },
    {
      kind: 'docx',
      label: m['file_studio.tool.docx'](),
      compactLabel: m['file_studio.tool.docx_short'](),
      icon: FileText,
    },
    {
      kind: 'xlsx',
      label: m['file_studio.tool.xlsx'](),
      compactLabel: m['file_studio.tool.xlsx_short'](),
      icon: Table2,
    },
  ];
}

/**
 * "Create files" glyph for the composer trigger — two 16:9 slides stacked the
 * way lucide's `copy` stacks squares: the front slide complete with a title
 * bar and body line, the back one showing only its left and top edges peeking
 * out (the PPT / Word / Excel outputs the menu generates). Drawn in lucide's
 * stroke style so it sits next to Plus and Columns2 in the toolbar.
 */
function CreateFileIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* back slide — left + top edges peeking out behind the front one */}
      <path d="M2 13V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2" />
      {/* front 16:9 slide */}
      <path d="M8 10h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" />
      {/* title bar + body line as the slide's content */}
      <path d="M9 13h5" />
      <path d="M9 16h8" />
    </svg>
  );
}

/** The exact three-item tool picker from the Lorka-style chat composer. */
export function ChatFileToolPicker({
  value,
  onChange,
  disabled,
  compact = false,
  kinds,
}: {
  value: FileKind | null;
  onChange: (kind: FileKind | null) => void;
  disabled?: boolean;
  compact?: boolean;
  /**
   * Restrict the entry to a subset of tools. A single allowed kind becomes a
   * direct toggle button (no popover) — e.g. the PPT-only composer entry.
   */
  kinds?: FileKind[];
}) {
  const [open, setOpen] = useState(false);
  const tools = getTools().filter(
    (tool) => !kinds?.length || kinds.includes(tool.kind)
  );
  const active = tools.find((tool) => tool.kind === value);
  const ActiveIcon = active?.icon;

  if (active) {
    return (
      <div className="text-foreground/70 bg-foreground/[0.05] flex h-10 shrink-0 items-center gap-1 rounded-lg pr-1 pl-2 text-xs font-medium">
        {ActiveIcon ? (
          <ActiveIcon className="size-3.5" />
        ) : (
          <CreateFileIcon className="size-3.5" />
        )}
        <span className="max-w-20 truncate sm:max-w-none">
          {active.compactLabel}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label={m['file_studio.clear_tool']()}
          className="hover:bg-foreground/10 grid size-7 place-items-center rounded-md transition-colors disabled:opacity-45"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  // Single allowed kind — toggle it straight on instead of opening a menu.
  if (tools.length === 1) {
    const tool = tools[0];
    return (
      <button
        type="button"
        onClick={() => onChange(tool.kind)}
        disabled={disabled}
        aria-label={tool.label}
        title={tool.label}
        className={cn(
          'text-foreground/65 hover:bg-foreground/5 hover:text-foreground inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-45',
          compact ? 'size-10 rounded-full' : 'px-2'
        )}
      >
        <CreateFileIcon className={compact ? 'size-[22px]' : 'size-4'} />
        {!compact && <span>{tool.label}</span>}
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'text-foreground/65 hover:bg-foreground/5 hover:text-foreground inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-45',
          compact ? 'size-10 rounded-full' : 'px-2'
        )}
        aria-label={m['file_studio.create']()}
        title={m['file_studio.create']()}
      >
        <CreateFileIcon className={compact ? 'size-[22px]' : 'size-4'} />
        {!compact && <span>{m['file_studio.create']()}</span>}
        {!compact && (
          <ChevronDown
            className={cn(
              'size-3.5 transition-transform',
              open && 'rotate-180'
            )}
          />
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={10}
        className="w-60 overflow-hidden rounded-[18px] border-black/10 bg-white p-1.5 text-[#202020] shadow-[0_18px_45px_-18px_rgba(0,0,0,0.28)]"
      >
        <div role="listbox" aria-label={m['file_studio.create']()}>
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.kind}
                type="button"
                role="option"
                onClick={() => {
                  onChange(tool.kind);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-[13px] px-2.5 py-2.5 text-left text-[15px] leading-none font-medium transition-colors hover:bg-black/[0.055] focus-visible:bg-black/[0.07] focus-visible:outline-none"
              >
                <Icon strokeWidth={2.1} className="size-5 shrink-0" />
                <span>{tool.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function galleryCopy(kind: FileKind) {
  if (kind === 'pptx') {
    return {
      title: m['file_studio.gallery.pptx.title'](),
      examples: m['file_studio.gallery.pptx.examples']().split('|'),
    };
  }
  if (kind === 'docx') {
    return {
      title: m['file_studio.gallery.docx.title'](),
      examples: m['file_studio.gallery.docx.examples']().split('|'),
    };
  }
  return {
    title: m['file_studio.gallery.xlsx.title'](),
    examples: m['file_studio.gallery.xlsx.examples']().split('|'),
  };
}

const GALLERY_TEMPLATES: Array<{ id: FileTemplate }> = [
  { id: 'business' },
  { id: 'modern' },
  { id: 'minimal' },
  { id: 'creative' },
];

/** A working prompt + template picker shown under the chat composer. */
export function FileStyleGallery({
  kind,
  value,
  onTemplateChange,
  onPromptPick,
}: {
  kind: FileKind;
  value: FileTemplate;
  onTemplateChange: (template: FileTemplate) => void;
  onPromptPick: (prompt: string) => void;
}) {
  const copy = galleryCopy(kind);

  return (
    <section className="mt-10 w-full pt-5 text-left">
      <h2 className="text-sm font-semibold tracking-tight">{copy.title}</h2>
      <div className="mt-2.5 flex snap-x gap-2.5 overflow-x-auto pb-1">
        {copy.examples.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPromptPick(prompt)}
            className="group border-foreground/10 bg-card hover:border-foreground/25 hover:bg-foreground/[0.025] flex min-h-32 w-38 shrink-0 snap-start flex-col rounded-2xl border p-3 text-left transition-colors"
          >
            <span className="text-foreground/25 font-serif text-xl leading-none">
              “
            </span>
            <span className="text-foreground/75 group-hover:text-foreground mt-1.5 line-clamp-4 block text-[13px] leading-4 font-medium">
              {prompt}
            </span>
            <span className="text-foreground/40 group-hover:text-foreground/70 mt-auto pt-2.5 text-[10px] font-medium transition-colors">
              {m['file_studio.gallery.one_click']()}
            </span>
          </button>
        ))}
      </div>

      {kind !== 'xlsx' && (
        <>
          <h3 className="mt-5 text-sm font-semibold tracking-tight">
            {m['file_studio.gallery.templates']()}
          </h3>
          <div className="mt-2.5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {GALLERY_TEMPLATES.map((template) => {
              const selected = value === template.id;
              const label = templateLabel(template.id);
              return (
                <button
                  key={template.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onTemplateChange(template.id)}
                  className={cn(
                    'group bg-card relative overflow-hidden rounded-[18px] border p-1.5 text-left transition-all',
                    selected
                      ? 'border-foreground/65 ring-foreground/10 ring-2'
                      : 'border-foreground/10 hover:border-foreground/30 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5'
                  )}
                >
                  <TemplateCover template={template.id} label={label} />
                  <span className="mt-2 flex items-center justify-between px-1 pb-0.5 text-[13px] font-semibold">
                    {label}
                    {selected && (
                      <Check className="size-3.5" strokeWidth={2.5} />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function templateLabel(template: FileTemplate) {
  if (template === 'business') return m['file_studio.template.business']();
  if (template === 'modern') return m['file_studio.template.modern']();
  if (template === 'minimal') return m['file_studio.template.minimal']();
  return m['file_studio.template.creative']();
}

function TemplateCover({
  template,
  label,
}: {
  template: FileTemplate;
  label: string;
}) {
  const cover = {
    business: {
      bg: '#10233f',
      primary: '#2563eb',
      accent: '#f4b740',
      text: '#f8fafc',
      muted: '#b9c8df',
    },
    modern: {
      bg: '#f8f7ff',
      primary: '#7c3aed',
      accent: '#d8b4fe',
      text: '#261047',
      muted: '#745c99',
    },
    minimal: {
      bg: '#fbfbfa',
      primary: '#161616',
      accent: '#d4d4d4',
      text: '#171717',
      muted: '#737373',
    },
    creative: {
      bg: '#ffe7f2',
      primary: '#db2777',
      accent: '#ffb5d0',
      text: '#500724',
      muted: '#9d174d',
    },
  }[template];

  return (
    <div className="relative aspect-[1.38] overflow-hidden rounded-[13px] border border-black/[0.08] shadow-[0_1px_2px_rgba(15,23,42,0.08)]">
      <svg
        viewBox="0 0 320 232"
        role="img"
        aria-label={label}
        className="size-full"
      >
        <rect width="320" height="232" fill={cover.bg} />
        {template === 'business' && (
          <>
            <rect width="13" height="232" fill={cover.primary} />
            <rect
              x="37"
              y="31"
              width="54"
              height="7"
              rx="3.5"
              fill={cover.accent}
            />
            <text
              x="37"
              y="97"
              fill={cover.text}
              fontSize="29"
              fontWeight="700"
            >
              {label}
            </text>
            <rect
              x="37"
              y="117"
              width="166"
              height="5"
              rx="2.5"
              fill={cover.muted}
              opacity="0.8"
            />
            <rect
              x="37"
              y="130"
              width="124"
              height="5"
              rx="2.5"
              fill={cover.muted}
              opacity="0.55"
            />
            <path d="M232 34h57v57z" fill={cover.primary} opacity="0.85" />
            <rect
              x="37"
              y="192"
              width="62"
              height="4"
              rx="2"
              fill={cover.accent}
            />
          </>
        )}
        {template === 'modern' && (
          <>
            <circle
              cx="310"
              cy="-6"
              r="116"
              fill="none"
              stroke={cover.primary}
              strokeWidth="1.4"
              opacity="0.45"
            />
            <circle
              cx="310"
              cy="-6"
              r="82"
              fill="none"
              stroke={cover.primary}
              strokeWidth="1.4"
              opacity="0.6"
            />
            <circle
              cx="310"
              cy="-6"
              r="47"
              fill="none"
              stroke={cover.primary}
              strokeWidth="1.4"
              opacity="0.78"
            />
            <rect
              x="30"
              y="38"
              width="43"
              height="7"
              rx="3.5"
              fill={cover.primary}
            />
            <text
              x="30"
              y="107"
              fill={cover.text}
              fontSize="29"
              fontWeight="700"
            >
              {label}
            </text>
            <rect
              x="30"
              y="126"
              width="158"
              height="5"
              rx="2.5"
              fill={cover.muted}
              opacity="0.68"
            />
            <rect
              x="30"
              y="139"
              width="112"
              height="5"
              rx="2.5"
              fill={cover.muted}
              opacity="0.42"
            />
            <rect
              x="30"
              y="185"
              width="100"
              height="12"
              rx="6"
              fill={cover.accent}
            />
          </>
        )}
        {template === 'minimal' && (
          <>
            <rect
              x="28"
              y="30"
              width="32"
              height="5"
              rx="2.5"
              fill={cover.primary}
            />
            <text
              x="28"
              y="103"
              fill={cover.text}
              fontSize="30"
              fontWeight="700"
            >
              {label}
            </text>
            <rect
              x="28"
              y="126"
              width="195"
              height="4"
              rx="2"
              fill={cover.accent}
            />
            <rect
              x="28"
              y="138"
              width="154"
              height="4"
              rx="2"
              fill={cover.accent}
            />
            <rect
              x="28"
              y="150"
              width="112"
              height="4"
              rx="2"
              fill={cover.accent}
            />
            <rect
              x="28"
              y="196"
              width="55"
              height="4"
              rx="2"
              fill={cover.primary}
            />
          </>
        )}
        {template === 'creative' && (
          <>
            <circle
              cx="278"
              cy="46"
              r="76"
              fill={cover.primary}
              opacity="0.95"
            />
            <path d="M0 186 124 118l44 114H0z" fill={cover.accent} />
            <rect
              x="31"
              y="31"
              width="48"
              height="7"
              rx="3.5"
              fill={cover.text}
            />
            <text
              x="31"
              y="107"
              fill={cover.text}
              fontSize="30"
              fontWeight="700"
            >
              {label}
            </text>
            <rect
              x="31"
              y="126"
              width="151"
              height="5"
              rx="2.5"
              fill={cover.text}
              opacity="0.48"
            />
            <rect
              x="31"
              y="139"
              width="106"
              height="5"
              rx="2.5"
              fill={cover.text}
              opacity="0.28"
            />
            <rect
              x="222"
              y="169"
              width="62"
              height="31"
              rx="5"
              fill="#fff"
              opacity="0.85"
            />
          </>
        )}
      </svg>
    </div>
  );
}

export function FileGenerationTurn({
  prompt,
  kind,
  artifact,
  pending,
}: {
  prompt: string;
  kind: FileKind;
  template: FileTemplate;
  artifact?: FileArtifact;
  pending?: boolean;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-3 px-4">
      {/* The sent prompt reads as a small caption rather than a chat bubble —
          one muted line above the artifact card. */}
      <p className="text-foreground/45 ml-auto w-fit max-w-[70%] truncate text-right text-xs font-medium">
        {prompt}
      </p>
      {pending ? (
        <article className="bg-card border-foreground/10 max-w-[240px] overflow-hidden rounded-2xl border shadow-sm">
          <div
            className="bg-muted relative isolate aspect-[16/8.4] overflow-hidden"
            role="status"
            aria-label={m['file_studio.generating']()}
          >
            <img
              src={GENERATION_PREVIEW_IMAGES[kind]}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 size-full object-cover opacity-70 saturate-75"
            />
            <div
              aria-hidden="true"
              className="bg-background/20 absolute inset-0 backdrop-blur-[1px]"
            />
            <span className="bg-background/80 text-foreground absolute top-1/2 left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 shadow-[0_10px_26px_rgba(15,23,42,0.16)]">
              <Loader2 className="size-4 animate-spin" strokeWidth={2.3} />
            </span>
          </div>
        </article>
      ) : artifact ? (
        /* The finished artifact is its editorial cover — one large page that
           opens the right-side viewer on click, with the actions as quiet
           links underneath the card instead of a chrome bar on top. The same
           treatment for decks, documents, and spreadsheets. */
        <div className="w-full max-w-[615px]">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            aria-label={m['file_studio.preview']()}
            className="block w-full cursor-pointer rounded-lg text-left transition-transform duration-200 hover:-translate-y-0.5"
          >
            <div className="aspect-video">
              <FileCover artifact={artifact} />
            </div>
          </button>
          <div className="mt-2.5 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="hover:bg-foreground/5 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors"
            >
              <Eye className="size-3.5" />
              {m['file_studio.preview']()}
            </button>
            <DownloadArtifact artifact={artifact} />
          </div>
        </div>
      ) : null}
      {artifact && (
        <FilePreviewPanel
          artifact={artifact}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

function downloadArtifact(artifact: FileArtifact) {
  const bytes = Uint8Array.from(window.atob(artifact.base64), (character) =>
    character.charCodeAt(0)
  );
  const url = URL.createObjectURL(
    new Blob([bytes], { type: artifact.mimeType })
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function DownloadArtifact({ artifact }: { artifact: FileArtifact }) {
  return (
    <button
      type="button"
      onClick={() => downloadArtifact(artifact)}
      className="hover:bg-foreground/5 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors"
    >
      <Download className="size-3.5" />
      {m['file_studio.download']()}
    </button>
  );
}

/** One page of the right-side viewer: the cover, an editorial list page
 *  (a deck slide or a document section), or a chunk of spreadsheet rows. */
type ContentPage =
  | { type: 'cover' }
  | { type: 'list'; title: string; body: string[] }
  | { type: 'table'; columns: string[]; rows: Array<Array<string | number>> };

const TABLE_PAGE_ROWS = 8;

/**
 * Every artifact pages through the same viewer: a cover first, then its
 * content — deck slides after the title slide, document sections, or the
 * spreadsheet's rows split into screen-sized chunks.
 */
function filePages(artifact: FileArtifact): ContentPage[] {
  const { preview } = artifact;

  if (preview.kind === 'docx') {
    const pages: ContentPage[] = [{ type: 'cover' }];
    for (const section of preview.sections ?? []) {
      pages.push({
        type: 'list',
        title: section.heading,
        body: section.paragraphs,
      });
    }
    return pages;
  }

  if (preview.kind === 'xlsx') {
    const pages: ContentPage[] = [{ type: 'cover' }];
    const rows = preview.rows ?? [];
    for (let i = 0; i < rows.length; i += TABLE_PAGE_ROWS) {
      pages.push({
        type: 'table',
        columns: preview.columns ?? [],
        rows: rows.slice(i, i + TABLE_PAGE_ROWS),
      });
    }
    return pages;
  }

  const slides = preview.slides ?? [];
  return [
    { type: 'cover' },
    ...slides.slice(1).map((slide) => ({
      type: 'list' as const,
      title: slide.title,
      body: slide.body,
    })),
  ];
}

/** The count line for a finished artifact — its yellow cover band and the
 *  viewer header both speak in the file's own unit (slides/sections/rows). */
function fileCountLabel(artifact: FileArtifact): string {
  const { preview } = artifact;
  if (preview.kind === 'docx') {
    return m['file_studio.preview.sections_count']({
      count: preview.sections?.length ?? 1,
    });
  }
  if (preview.kind === 'xlsx') {
    return m['file_studio.preview.rows_count']({
      count: preview.rows?.length ?? 0,
    });
  }
  return m['file_studio.preview.slides_count']({
    count: preview.slides?.length ?? 1,
  });
}

/** The cover's small uppercase line under the title. */
function coverTagline(artifact: FileArtifact): string {
  const { preview } = artifact;
  if (preview.kind === 'pptx') {
    return preview.subtitle ?? preview.slides?.[0]?.body?.[0] ?? '';
  }
  if (preview.kind === 'docx') {
    return preview.subtitle ?? preview.sections?.[0]?.paragraphs?.[0] ?? '';
  }
  return preview.subtitle ?? '';
}

/**
 * Right-side file viewer: every generated page stacked in one vertical,
 * snap-assisted scroll column (swipe/scroll up and down through the file),
 * a live page counter in the header, and a download action. Rendered in a
 * portal over the page's right edge.
 */
function FilePreviewPanel({
  artifact,
  open,
  onClose,
}: {
  artifact: FileArtifact;
  open: boolean;
  onClose: () => void;
}) {
  const pages = filePages(artifact);
  const Icon =
    getTools().find((tool) => tool.kind === artifact.preview.kind)?.icon ??
    Presentation;
  const scrollRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  // 1-based page nearest the viewport center; ref copy keeps the keyboard
  // handler reading fresh values without re-subscribing on every scroll.
  const [current, setCurrent] = useState(1);
  const currentRef = useRef(1);

  // Each open starts back at the cover.
  useEffect(() => {
    if (!open) return;
    currentRef.current = 1;
    setCurrent(1);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const goTo = (index: number) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, index));
      slideRefs.current[clamped]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowRight' ||
        event.key === 'PageDown'
      ) {
        event.preventDefault();
        goTo(currentRef.current);
      }
      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowLeft' ||
        event.key === 'PageUp'
      ) {
        event.preventDefault();
        goTo(currentRef.current - 2);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, pages.length]);

  /** Mark the slide whose center is closest above the viewport middle. */
  function trackCurrent() {
    const el = scrollRef.current;
    if (!el) return;
    const mid = el.getBoundingClientRect().top + el.clientHeight / 2;
    let best = 0;
    slideRefs.current.forEach((node, index) => {
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (rect.top + rect.height / 2 <= mid) best = index;
    });
    if (best + 1 !== currentRef.current) {
      currentRef.current = best + 1;
      setCurrent(best + 1);
    }
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div
        className="animate-in fade-in-0 absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      {/* Pure-white paper backdrop. The token overrides pin every
          `foreground`-derived utility inside to dark ink on white, so the
          viewer reads as a white page in dark mode too. */}
      <div className="border-foreground/10 animate-in slide-in-from-right absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l bg-white shadow-2xl duration-300 [--background:#ffffff] [--foreground:#2e2e2b]">
        <header className="border-foreground/10 flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <span className="bg-foreground text-background grid size-8 shrink-0 place-items-center rounded-lg">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{artifact.fileName}</p>
            <p className="text-foreground/50 mt-0.5 truncate text-xs tabular-nums">
              {current} / {pages.length}
            </p>
          </div>
          <button
            type="button"
            onClick={() => downloadArtifact(artifact)}
            className="hover:bg-foreground/5 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors"
          >
            <Download className="size-3.5" />
            {m['file_studio.download']()}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={m['file_studio.preview.close']()}
            className="text-foreground/50 hover:bg-foreground/5 hover:text-foreground grid size-8 place-items-center rounded-lg transition-colors"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* The deck as one vertical scroll column — slides snap to center as
            you swipe, the header counter follows the one in view. */}
        <div
          ref={scrollRef}
          onScroll={trackCurrent}
          className="flex min-h-0 snap-y snap-proximity flex-col items-center gap-5 overflow-y-auto p-4 pb-10 sm:gap-6 sm:p-6"
        >
          {pages.map((page, index) => (
            <div
              key={index}
              ref={(node) => {
                slideRefs.current[index] = node;
              }}
              className="aspect-video w-full max-w-[640px] shrink-0 snap-center"
            >
              <PreviewPageView
                artifact={artifact}
                page={page}
                index={index}
                total={pages.length}
              />
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Template chip colors, reused as each deck's editorial accent. */
const TEMPLATE_ACCENTS: Record<FileTemplate, string> = {
  business: '#2563eb',
  modern: '#7c3aed',
  minimal: '#525252',
  creative: '#db2777',
};

/** One viewer page in the artifact's editorial paper style. */
function PreviewPageView({
  artifact,
  page,
  index,
  total,
}: {
  artifact: FileArtifact;
  page: ContentPage;
  index: number;
  total: number;
}) {
  const accent = TEMPLATE_ACCENTS[artifact.template] ?? '#4a7fb5';
  if (page.type === 'cover') {
    return <FileCover artifact={artifact} />;
  }
  if (page.type === 'table') {
    return <TablePageView page={page} index={index} total={total} />;
  }
  return (
    <ListPageView page={page} index={index} total={total} accent={accent} />
  );
}

/**
 * The file's cover — the artifact card in the chat and page one of the
 * viewer: cream paper, yellow dash + kind eyebrow, stacked serif title with
 * an accent-colored first word, an accent side panel with the vertical year,
 * and a yellow stats band (slides / sections / rows + year).
 */
function FileCover({ artifact }: { artifact: FileArtifact }) {
  const accent = TEMPLATE_ACCENTS[artifact.template] ?? '#4a7fb5';
  const { preview } = artifact;
  const eyebrow =
    preview.kind === 'pptx'
      ? m['file_studio.tool.pptx_short']()
      : preview.kind === 'docx'
        ? m['file_studio.tool.docx_short']()
        : m['file_studio.tool.xlsx_short']();
  const words = preview.title.split(' ');
  // Latin titles lead with an accent-colored word (like the reference's blue
  // "WETLANDS"); scripts without spaces render as one charcoal block.
  const lead = words.length > 1 ? words[0] : '';
  const rest = words.length > 1 ? words.slice(1).join(' ') : preview.title;
  const tagline =
    coverTagline(artifact) ||
    artifact.fileName.replace(/\.(pptx|docx|xlsx|PPTX|DOCX|XLSX)$/, '');
  const year = new Date().getFullYear();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-[#f2efe6] p-[4.5%] text-[#1a1a1a] shadow-[0_18px_45px_-18px_rgba(0,0,0,0.4)] ring-1 ring-black/10">
      <div className="flex items-center gap-2">
        <span className="h-[3px] w-6 shrink-0 bg-[#f2b705]" />
        <span className="text-[0.55rem] font-semibold tracking-[0.24em] text-black/55">
          {eyebrow}
        </span>
      </div>

      <div className="mt-[3%] flex min-h-0 flex-1 gap-[4%]">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="font-serif leading-none font-medium">
            {lead && (
              <span
                className="block truncate text-[1.15rem] tracking-[0.14em]"
                style={{ color: accent }}
              >
                {lead}
              </span>
            )}
            <span className="mt-1 block text-[1.9rem] leading-[1.1] font-semibold text-balance">
              {rest}
            </span>
          </h2>
          {preview.kind === 'xlsx' ? (
            <CoverMiniTable artifact={artifact} />
          ) : (
            <p className="mt-[2.5%] line-clamp-2 text-[0.6rem] font-bold tracking-[0.14em] text-black/60 uppercase">
              {tagline}
            </p>
          )}
          <p className="mt-auto truncate text-[0.5rem] text-black/45">
            {artifact.fileName}
          </p>
        </div>

        <div
          className="relative w-[24%] shrink-0 overflow-hidden rounded-l-[2.5rem]"
          style={{ backgroundColor: accent }}
        >
          <span
            aria-hidden="true"
            className="absolute -top-[30%] left-1/2 block aspect-square w-[140%] -translate-x-1/2 rounded-full bg-white/10"
          />
          <span className="absolute inset-x-0 bottom-[6%] flex justify-center text-[1.3rem] font-light tracking-[0.3em] text-white/90 [writing-mode:vertical-rl]">
            {year}
          </span>
        </div>
      </div>

      <div className="mt-[3%] flex divide-x divide-black/25 bg-[#f2b705] text-black">
        <span className="px-3 py-1.5 text-[0.6rem] font-semibold whitespace-nowrap">
          {fileCountLabel(artifact)}
        </span>
        <span className="px-3 py-1.5 text-[0.6rem] font-semibold whitespace-nowrap">
          {year}
        </span>
      </div>
    </div>
  );
}

/** A spreadsheet's cover shows its shape instead of a tagline: the header
 *  row plus the first data rows, hairline-ruled. */
function CoverMiniTable({ artifact }: { artifact: FileArtifact }) {
  const columns = artifact.preview.columns?.slice(0, 4) ?? [];
  const rows = artifact.preview.rows?.slice(0, 2) ?? [];
  if (columns.length === 0) return null;
  const grid = {
    gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
  };
  return (
    <div className="mt-[3%] w-full max-w-[88%] overflow-hidden rounded-[4px] ring-1 ring-black/10">
      <div
        className="grid divide-x divide-black/10 bg-black/[0.05] text-[0.5rem] font-bold tracking-[0.06em] text-black/70"
        style={grid}
      >
        {columns.map((column) => (
          <span key={column} className="truncate px-1.5 py-1">
            {column}
          </span>
        ))}
      </div>
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="grid divide-x divide-black/10 border-t border-black/10 text-[0.5rem] text-black/65"
          style={grid}
        >
          {columns.map((_, columnIndex) => (
            <span key={columnIndex} className="truncate px-1.5 py-1">
              {row[columnIndex] ?? ''}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A numbered hairline list page under the page title — deck slides and
 * document sections share it.
 */
function ListPageView({
  page,
  index,
  total,
  accent,
}: {
  page: { title: string; body: string[] };
  index: number;
  total: number;
  accent: string;
}) {
  const words = page.title.split(' ');
  const lead = words.length > 1 ? words[0] : '';
  const rest = words.length > 1 ? words.slice(1).join(' ') : page.title;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-[#f2efe6] p-[4.5%] text-[#1a1a1a] shadow-[0_18px_45px_-18px_rgba(0,0,0,0.4)] ring-1 ring-black/10">
      <div className="flex items-center gap-2">
        <span className="h-[3px] w-6 shrink-0 bg-[#f2b705]" />
        <span className="text-[0.55rem] font-semibold tracking-[0.24em] text-black/55">
          {String(index + 1).padStart(2, '0')}
        </span>
      </div>

      <div className="mt-[3%] flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="font-serif leading-none font-medium">
            {lead && (
              <span
                className="block truncate text-[1.15rem] tracking-[0.14em]"
                style={{ color: accent }}
              >
                {lead}
              </span>
            )}
            <span className="mt-1 block text-[1.9rem] leading-[1.1] font-semibold text-balance">
              {rest}
            </span>
          </h2>
        </div>
      </div>

      <div className="mt-[2.5%] flex min-h-0 flex-1 flex-col divide-y divide-black/10 overflow-y-auto [scrollbar-width:none]">
        {page.body.map((line, lineIndex) => (
          <div key={lineIndex} className="flex items-baseline gap-3 py-[1.6%]">
            <span
              className="shrink-0 text-[0.6rem] font-bold tabular-nums"
              style={{ color: accent }}
            >
              {String(lineIndex + 1).padStart(2, '0')}
            </span>
            <p className="line-clamp-3 text-[0.78rem] leading-relaxed text-black/75">
              {line}
            </p>
          </div>
        ))}
        <span className="ml-auto pt-[1.5%] text-[0.55rem] font-semibold tracking-[0.18em] text-black/40 tabular-nums">
          {index + 1} / {total}
        </span>
      </div>
    </div>
  );
}

/** A spreadsheet page: header row plus one chunk of data rows, hairline
 *  ruled, page number bottom-right like the list pages. */
function TablePageView({
  page,
  index,
  total,
}: {
  page: { columns: string[]; rows: Array<Array<string | number>> };
  index: number;
  total: number;
}) {
  const columns = page.columns.length ? page.columns : [''];
  const grid = {
    gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
  };
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-[#f2efe6] p-[4.5%] text-[#1a1a1a] shadow-[0_18px_45px_-18px_rgba(0,0,0,0.4)] ring-1 ring-black/10">
      <div className="flex items-center gap-2">
        <span className="h-[3px] w-6 shrink-0 bg-[#f2b705]" />
        <span className="text-[0.55rem] font-semibold tracking-[0.24em] text-black/55">
          {String(index + 1).padStart(2, '0')}
        </span>
      </div>

      <div className="mt-[3%] flex min-h-0 flex-1 flex-col overflow-hidden rounded-[4px] ring-1 ring-black/10">
        <div
          className="grid divide-x divide-black/10 bg-black/[0.05] text-[0.55rem] font-bold tracking-[0.06em] text-black/70"
          style={grid}
        >
          {columns.map((column) => (
            <span key={column} className="truncate px-2 py-1.5">
              {column}
            </span>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-black/10 overflow-y-auto [scrollbar-width:none]">
          {page.rows.map((row, rowIndex) => (
            <div
              key={rowIndex}
              className="grid divide-x divide-black/10 text-[0.65rem] text-black/75"
              style={grid}
            >
              {columns.map((_, columnIndex) => (
                <span key={columnIndex} className="truncate px-2 py-1.5">
                  {row[columnIndex] ?? ''}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <span className="mt-[1.5%] text-right text-[0.55rem] font-semibold tracking-[0.18em] text-black/40 tabular-nums">
        {index + 1} / {total}
      </span>
    </div>
  );
}
