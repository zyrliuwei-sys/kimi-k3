import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ChevronDown,
  Copy,
  Download,
  Eye,
  FileText,
  Loader2,
  Pencil,
  Presentation,
  Table2,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export type FileKind = 'pptx' | 'docx' | 'xlsx';
export type FileTemplate =
  | 'business'
  | 'modern'
  | 'minimal'
  | 'creative'
  | 'blue-professional'
  | 'creative-mode'
  | 'vellum'
  | 'dark-botanical'
  | 'notebook-tabs'
  | 'neon-cyber'
  | 'swiss-modern'
  | 'paper-ink';

type PresentationPreviewLayout =
  | 'cover'
  | 'bullets'
  | 'cards'
  | 'split'
  | 'flow'
  | 'statement'
  | 'closing';

/**
 * Accept list shared by every composer file input (playground single-column
 * + compare columns) so both pickers offer exactly the same file types.
 */
export const ATTACHMENT_ACCEPT =
  'image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.pages,.numbers,.md,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/markdown,text/plain,text/csv';

/** Structural subset of the playground's Attachment — enough to render a chip. */
export interface AttachmentChipItem {
  id: string;
  type: 'image' | 'video' | 'document';
  url: string;
  /** Storage key — forwarded to the server for signed downloads. */
  key?: string;
  previewUrl?: string;
  filename?: string;
  uploadStatus: 'uploading' | 'done' | 'error';
}

/** Compact attachment chip row for the mirrored compare composers. */
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: AttachmentChipItem[];
  onRemove: (id: string) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-1 pt-1 pb-1.5">
      {attachments.map((a) => {
        const isUploading = a.uploadStatus === 'uploading';
        const isError = a.uploadStatus === 'error';
        return (
          <div
            key={a.id}
            className={cn(
              'bg-muted/60 border-foreground/10 relative flex items-center gap-1.5 overflow-hidden rounded-lg border py-1 pr-1 pl-1 transition-opacity',
              isUploading && 'opacity-80',
              isError && 'border-destructive/40 opacity-60'
            )}
          >
            {a.type === 'image' ? (
              <img
                src={a.previewUrl || a.url}
                alt={a.filename || ''}
                className="size-8 shrink-0 rounded-md object-cover"
              />
            ) : a.type === 'video' ? (
              <video
                src={a.previewUrl || a.url}
                muted
                playsInline
                preload="metadata"
                className="size-8 shrink-0 rounded-md object-cover"
              />
            ) : (
              <span className="bg-foreground/5 text-foreground/60 flex size-8 shrink-0 items-center justify-center rounded-md">
                <FileText className="size-3.5" />
              </span>
            )}
            <span className="text-foreground/60 max-w-[7rem] truncate text-xs">
              {a.filename || a.type}
            </span>
            {isUploading && (
              <Loader2 className="text-foreground/45 size-3 shrink-0 animate-spin" />
            )}
            {isError && (
              <span
                title={m['playground.attachment.err_upload_failed']({
                  name: a.filename || a.type,
                })}
                className="text-destructive text-[10px] font-medium tracking-wide uppercase"
              >
                {m['playground.attachment.status_error']()}
              </span>
            )}
            <button
              type="button"
              onClick={() => onRemove(a.id)}
              aria-label={m['playground.attachment.remove']()}
              className="text-foreground/45 hover:text-foreground hover:bg-foreground/10 -mr-0.5 rounded-full p-0.5 transition-colors"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

const GENERATION_PREVIEW_IMAGES: Record<FileKind, string> = {
  docx: '/imgs/generated/file-generation-document-1787980672654.png',
  pptx: '/imgs/generated/file-generation-presentation-1787990669577.png',
  xlsx: '/imgs/generated/file-generation-spreadsheet-1788089843131.png',
};

export interface FileArtifact {
  fileName: string;
  mimeType: string;
  base64: string;
  mode: 'ai' | 'draft';
  template: FileTemplate;
  allocation?: {
    sourceUnits: number;
    outputUnits: number;
    unit: 'slides' | 'sections' | 'rows';
    columns?: number;
    explicit: boolean;
  };
  preview: {
    kind: FileKind;
    title: string;
    subtitle?: string;
    slides?: Array<{
      title: string;
      body: string[];
      layout?: PresentationPreviewLayout;
    }>;
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
      <div className="text-foreground/70 bg-foreground/[0.05] flex h-8 shrink-0 items-center gap-1 rounded-md pr-0.5 pl-1.5 text-[11px] font-medium">
        {ActiveIcon ? (
          <ActiveIcon className="size-3" />
        ) : (
          <CreateFileIcon className="size-3" />
        )}
        <span className="max-w-20 truncate sm:max-w-none">
          {active.compactLabel}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label={m['file_studio.clear_tool']()}
          className="hover:bg-foreground/10 grid size-5 place-items-center rounded transition-colors disabled:opacity-45"
        >
          <X className="size-3" />
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

/**
 * Editable PPTX systems translated from the companion HTML deck library.
 * DOCX/XLSX keep the original office-file themes; these selections are for
 * presentations, where composition matters as much as the color palette.
 */
const PRESENTATION_TEMPLATES: Array<{ id: FileTemplate }> = [
  { id: 'blue-professional' },
  { id: 'creative-mode' },
  { id: 'vellum' },
  { id: 'dark-botanical' },
  { id: 'notebook-tabs' },
  { id: 'neon-cyber' },
  { id: 'swiss-modern' },
  { id: 'paper-ink' },
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
  const templates =
    kind === 'pptx' ? PRESENTATION_TEMPLATES : GALLERY_TEMPLATES;

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
        <div
          className={cn(
            'mt-5 grid grid-cols-2 gap-3',
            kind === 'pptx' ? 'lg:grid-cols-4' : 'lg:grid-cols-4'
          )}
        >
          {templates.map((template) => {
            const selected = value === template.id;
            const label = templateLabel(template.id);
            return (
              <button
                key={template.id}
                type="button"
                aria-label={label}
                aria-pressed={selected}
                onClick={() => onTemplateChange(template.id)}
                className={cn(
                  'group relative overflow-hidden rounded-[13px] text-left transition-all focus-visible:outline-none',
                  selected
                    ? 'ring-foreground/25 ring-2 ring-offset-2'
                    : 'hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 focus-visible:ring-2 focus-visible:ring-offset-2'
                )}
              >
                <TemplateCover template={template.id} label={label} />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function templateLabel(template: FileTemplate) {
  if (template === 'blue-professional')
    return m['file_studio.template.blue_professional']();
  if (template === 'creative-mode')
    return m['file_studio.template.creative_mode']();
  if (template === 'vellum') return m['file_studio.template.vellum']();
  if (template === 'dark-botanical')
    return m['file_studio.template.dark_botanical']();
  if (template === 'notebook-tabs')
    return m['file_studio.template.notebook_tabs']();
  if (template === 'neon-cyber') return m['file_studio.template.neon_cyber']();
  if (template === 'swiss-modern')
    return m['file_studio.template.swiss_modern']();
  if (template === 'paper-ink') return m['file_studio.template.paper_ink']();
  if (template === 'business') return m['file_studio.template.business']();
  if (template === 'modern') return m['file_studio.template.modern']();
  if (template === 'minimal') return m['file_studio.template.minimal']();
  return m['file_studio.template.creative']();
}

function TemplateCover({
  template,
  label,
  compact = false,
}: {
  template: FileTemplate;
  label: string;
  compact?: boolean;
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
    'blue-professional': {
      bg: '#fdfae7',
      primary: '#1e2bfa',
      accent: '#e3e7ff',
      text: '#111111',
      muted: '#6b6b6b',
    },
    'creative-mode': {
      bg: '#efe9d9',
      primary: '#1f8a4c',
      accent: '#f06ca8',
      text: '#0f0f0f',
      muted: '#2a2a2a',
    },
    vellum: {
      bg: '#2a3870',
      primary: '#e8d85c',
      accent: '#3a7878',
      text: '#e8d85c',
      muted: '#b5b05e',
    },
    'dark-botanical': {
      bg: '#0f0f0f',
      primary: '#d4a574',
      accent: '#e8b4b8',
      text: '#e8e4df',
      muted: '#9a9590',
    },
    'notebook-tabs': {
      bg: '#2d2d2d',
      primary: '#1a1a1a',
      accent: '#98d4bb',
      text: '#1a1a1a',
      muted: '#68645d',
    },
    'neon-cyber': {
      bg: '#0a0f1c',
      primary: '#00ffcc',
      accent: '#ff00aa',
      text: '#effffb',
      muted: '#82a6b7',
    },
    'swiss-modern': {
      bg: '#ffffff',
      primary: '#ff3300',
      accent: '#121212',
      text: '#111111',
      muted: '#575757',
    },
    'paper-ink': {
      bg: '#faf9f7',
      primary: '#c41e3a',
      accent: '#eadfd7',
      text: '#1a1a1a',
      muted: '#69605b',
    },
  }[template];

  return (
    <div
      className={cn(
        'relative aspect-[1.38] overflow-hidden border border-black/[0.08] shadow-[0_1px_2px_rgba(15,23,42,0.08)]',
        compact ? 'rounded-[3px]' : 'rounded-[13px]'
      )}
    >
      <svg
        viewBox="0 0 320 232"
        role="img"
        aria-label={label}
        className="size-full"
      >
        <rect width="320" height="232" fill={cover.bg} />
        {template === 'blue-professional' && (
          <>
            <path d="M232 0H320V232H190Z" fill={cover.accent} />
            <rect
              x="31"
              y="34"
              width="46"
              height="6"
              rx="3"
              fill={cover.primary}
            />
            <text
              x="31"
              y="104"
              fill={cover.text}
              fontSize="28"
              fontWeight="700"
            >
              {label}
            </text>
            <rect
              x="31"
              y="126"
              width="162"
              height="5"
              rx="2.5"
              fill={cover.muted}
              opacity="0.55"
            />
            <circle
              cx="268"
              cy="76"
              r="26"
              fill="none"
              stroke={cover.primary}
              strokeWidth="3"
              opacity="0.8"
            />
            <rect
              x="31"
              y="191"
              width="74"
              height="4"
              rx="2"
              fill={cover.primary}
            />
          </>
        )}
        {template === 'creative-mode' && (
          <>
            <rect
              x="202"
              y="24"
              width="90"
              height="184"
              fill={cover.primary}
              stroke={cover.text}
              strokeWidth="3"
            />
            <rect
              x="224"
              y="75"
              width="46"
              height="46"
              fill={cover.accent}
              stroke={cover.text}
              strokeWidth="3"
            />
            <rect
              x="231"
              y="137"
              width="48"
              height="14"
              fill="#f5c518"
              stroke={cover.text}
              strokeWidth="3"
            />
            <rect x="30" y="34" width="52" height="6" fill={cover.text} />
            <text
              x="30"
              y="104"
              fill={cover.text}
              fontSize="26"
              fontWeight="800"
            >
              {label}
            </text>
            <rect
              x="30"
              y="128"
              width="152"
              height="5"
              fill={cover.muted}
              opacity="0.45"
            />
            <rect x="30" y="191" width="72" height="4" fill="#e85a1f" />
          </>
        )}
        {template === 'vellum' && (
          <>
            <circle cx="266" cy="68" r="52" fill={cover.accent} opacity="0.8" />
            <rect
              x="29"
              y="38"
              width="64"
              height="2"
              fill={cover.primary}
              opacity="0.7"
            />
            <text
              x="29"
              y="104"
              fill={cover.text}
              fontSize="30"
              fontFamily="Georgia, serif"
              fontStyle="italic"
            >
              {label}
            </text>
            <rect
              x="29"
              y="128"
              width="166"
              height="4"
              fill={cover.muted}
              opacity="0.65"
            />
            <rect
              x="29"
              y="142"
              width="118"
              height="4"
              fill={cover.muted}
              opacity="0.38"
            />
            <rect x="29" y="193" width="60" height="3" fill={cover.primary} />
          </>
        )}
        {template === 'dark-botanical' && (
          <>
            <circle
              cx="278"
              cy="35"
              r="82"
              fill={cover.accent}
              opacity="0.32"
            />
            <circle
              cx="238"
              cy="82"
              r="64"
              fill={cover.primary}
              opacity="0.35"
            />
            <rect x="31" y="31" width="2" height="170" fill={cover.primary} />
            <text
              x="53"
              y="111"
              fill={cover.text}
              fontSize="29"
              fontFamily="Georgia, serif"
              fontStyle="italic"
            >
              {label}
            </text>
            <rect
              x="53"
              y="132"
              width="146"
              height="3"
              fill={cover.primary}
              opacity="0.8"
            />
            <rect
              x="53"
              y="146"
              width="112"
              height="3"
              fill={cover.muted}
              opacity="0.6"
            />
          </>
        )}
        {template === 'notebook-tabs' && (
          <>
            <rect
              x="20"
              y="15"
              width="257"
              height="202"
              rx="5"
              fill="#f8f6f1"
            />
            {['#98d4bb', '#c7b8ea', '#f4b8c5', '#a8d8ea', '#ffe6a7'].map(
              (color, index) => (
                <rect
                  key={color}
                  x="274"
                  y={28 + index * 35}
                  width="28"
                  height="24"
                  rx="3"
                  fill={color}
                />
              )
            )}
            {[58, 102, 146].map((cy, index) => (
              <circle
                key={cy}
                cx="35"
                cy={cy}
                r="4"
                fill="#2d2d2d"
                opacity={0.4 + index * 0.1}
              />
            ))}
            <text
              x="57"
              y="102"
              fill={cover.text}
              fontSize="27"
              fontFamily="Georgia, serif"
              fontWeight="700"
            >
              {label}
            </text>
            <rect
              x="57"
              y="123"
              width="151"
              height="4"
              fill={cover.muted}
              opacity="0.55"
            />
            <rect
              x="57"
              y="137"
              width="112"
              height="4"
              fill={cover.muted}
              opacity="0.3"
            />
            <rect x="57" y="184" width="59" height="3" fill="#f4b8c5" />
          </>
        )}
        {template === 'neon-cyber' && (
          <>
            {Array.from({ length: 7 }, (_, index) => (
              <path
                key={`v-${index}`}
                d={`M${index * 56} 0V232`}
                stroke={cover.primary}
                strokeWidth="0.6"
                opacity="0.16"
              />
            ))}
            {Array.from({ length: 5 }, (_, index) => (
              <path
                key={`h-${index}`}
                d={`M0 ${index * 48}H320`}
                stroke={cover.primary}
                strokeWidth="0.6"
                opacity="0.16"
              />
            ))}
            <rect
              x="24"
              y="24"
              width="274"
              height="184"
              fill="#0d1728"
              stroke={cover.primary}
              strokeWidth="1.5"
              opacity="0.96"
            />
            <rect x="41" y="42" width="46" height="4" fill={cover.accent} />
            <text
              x="41"
              y="110"
              fill={cover.text}
              fontSize="27"
              fontWeight="700"
            >
              {label}
            </text>
            <rect
              x="41"
              y="132"
              width="168"
              height="4"
              fill={cover.primary}
              opacity="0.65"
            />
            <rect
              x="41"
              y="146"
              width="121"
              height="4"
              fill={cover.primary}
              opacity="0.32"
            />
            <circle
              cx="256"
              cy="165"
              r="23"
              fill="none"
              stroke={cover.accent}
              strokeWidth="3"
            />
          </>
        )}
        {template === 'swiss-modern' && (
          <>
            <path d="M0 0H104V232H0Z" fill={cover.primary} />
            <circle cx="273" cy="51" r="33" fill={cover.accent} />
            <rect x="126" y="30" width="112" height="2" fill={cover.accent} />
            <text
              x="126"
              y="115"
              fill={cover.text}
              fontSize="28"
              fontWeight="800"
            >
              {label}
            </text>
            <rect
              x="126"
              y="138"
              width="153"
              height="5"
              fill={cover.accent}
              opacity="0.82"
            />
            <rect
              x="126"
              y="153"
              width="104"
              height="5"
              fill={cover.accent}
              opacity="0.42"
            />
            <text x="22" y="200" fill="#ffffff" fontSize="38" fontWeight="800">
              01
            </text>
          </>
        )}
        {template === 'paper-ink' && (
          <>
            <rect x="27" y="31" width="73" height="3" fill={cover.primary} />
            <text
              x="27"
              y="106"
              fill={cover.text}
              fontSize="31"
              fontFamily="Georgia, serif"
              fontWeight="700"
            >
              {label}
            </text>
            <text
              x="29"
              y="160"
              fill={cover.primary}
              fontSize="42"
              fontFamily="Georgia, serif"
            >
              “
            </text>
            <rect
              x="68"
              y="143"
              width="177"
              height="3"
              fill={cover.muted}
              opacity="0.55"
            />
            <rect
              x="68"
              y="156"
              width="143"
              height="3"
              fill={cover.muted}
              opacity="0.34"
            />
            <rect
              x="27"
              y="193"
              width="266"
              height="1"
              fill={cover.primary}
              opacity="0.65"
            />
          </>
        )}
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

/** A compact, faithful copy of the selected PPT system. The composer uses
 * this as a floating confirmation cue; it deliberately reuses the exact SVG
 * shown in the gallery, so selection and export never imply different styles. */
export function PresentationTemplateMiniature({
  template,
}: {
  template: FileTemplate;
}) {
  return (
    <TemplateCover
      template={template}
      label={templateLabel(template)}
      compact
    />
  );
}

export function FileGenerationTurn({
  prompt,
  kind,
  artifact,
  pending,
  onEditPrompt,
}: {
  prompt: string;
  kind: FileKind;
  template: FileTemplate;
  artifact?: FileArtifact;
  pending?: boolean;
  /** Returns the submitted prompt to the surrounding chat composer. */
  onEditPrompt?: (prompt: string) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);

  // Live elapsed counter for the pending card. A bare spinner reads as
  // "nothing is happening" during the 20–60s an AI plan can legitimately
  // take — a ticking number proves the request is still in flight.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    setElapsedSeconds(0);
    const startedAt = Date.now();
    const timer = setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000
    );
    return () => clearInterval(timer);
  }, [pending]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(m['file_studio.prompt_copied']());
    } catch {
      toast.error(m['file_studio.copy_failed']());
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 px-4">
      {/* The sent prompt reads as a small caption rather than a chat bubble —
          one muted line above the artifact card. */}
      <div className="ml-auto flex w-fit max-w-[70%] flex-col items-end">
        <p className="text-foreground/45 w-full truncate text-right text-xs font-medium">
          {prompt}
        </p>
        <div className="mt-1.5 flex items-center gap-1">
          <button
            type="button"
            onClick={() => void copyPrompt()}
            aria-label={m['file_studio.copy_prompt']()}
            title={m['file_studio.copy_prompt']()}
            className="text-foreground/45 hover:bg-foreground/5 hover:text-foreground inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors"
          >
            <Copy className="size-3" />
            {m['file_studio.copy_prompt']()}
          </button>
          {onEditPrompt && (
            <button
              type="button"
              onClick={() => onEditPrompt(prompt)}
              aria-label={m['file_studio.edit_prompt']()}
              title={m['file_studio.edit_prompt']()}
              className="text-foreground/45 hover:bg-foreground/5 hover:text-foreground inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors"
            >
              <Pencil className="size-3" />
              {m['file_studio.edit_prompt']()}
            </button>
          )}
        </div>
      </div>
      {pending ? (
        <article className="bg-card border-foreground/10 mt-4 max-w-[240px] overflow-hidden rounded-2xl border shadow-sm">
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
          <div className="px-3 py-2">
            <div className="text-foreground/70 flex items-center justify-between gap-2 text-[11px] font-medium">
              <span>{m['file_studio.generating']()}</span>
              <span className="text-foreground/50 font-mono tabular-nums">
                {m['file_studio.generating_elapsed']({
                  seconds: elapsedSeconds,
                })}
              </span>
            </div>
            <p className="text-foreground/40 mt-0.5 text-[10px] leading-snug">
              {m['file_studio.generating_hint']()}
            </p>
          </div>
        </article>
      ) : artifact ? (
        /* Each result should look like the application that opens it: a deck
           is landscape, a Word document is portrait, and a spreadsheet is a
           grid. A single landscape cover made DOCX replies look like PPT. */
        <div
          className={cn(
            'w-full',
            artifact.preview.kind === 'xlsx'
              ? 'max-w-[340px]'
              : artifact.preview.kind === 'docx'
                ? 'max-w-[260px]'
                : 'max-w-[300px]'
          )}
        >
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            aria-label={m['file_studio.preview']()}
            className="block w-full cursor-pointer rounded-lg text-left transition-transform duration-200 hover:-translate-y-0.5"
          >
            {artifact.preview.kind === 'xlsx' ? (
              /* A spreadsheet hugs its rows — a fixed ratio would pad empty
                 space under a short table. */
              <SpreadsheetArtifactCard artifact={artifact} />
            ) : (
              <div
                className={
                  artifact.preview.kind === 'docx'
                    ? 'aspect-[0.72]'
                    : 'aspect-video'
                }
              >
                {artifact.preview.kind === 'docx' ? (
                  <DocumentArtifactCard artifact={artifact} />
                ) : (
                  <PresentationCover artifact={artifact} />
                )}
              </div>
            )}
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

/** Compact spreadsheet-shaped reply card. Its rows are real plan data, so a
 * generated workbook is recognisable before the user opens or downloads it. */
function SpreadsheetArtifactCard({ artifact }: { artifact: FileArtifact }) {
  // All real columns — the thumbnail must mirror the generated workbook, not
  // a truncated prefix (the preview panel shows the full set).
  const columns = artifact.preview.columns ?? [];
  const rows = artifact.preview.rows?.slice(0, 5) ?? [];
  const visibleColumns = columns.length ? columns : ['Column A', 'Column B'];
  const grid = {
    gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(0, 1fr))`,
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-[0_18px_45px_-24px_rgba(15,23,42,0.45)]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3">
        <span className="grid size-5 place-items-center rounded bg-emerald-600 text-white">
          <Table2 className="size-3" />
        </span>
        <span className="min-w-0 truncate text-[11px] font-semibold text-slate-700">
          {artifact.preview.title}
        </span>
        <span className="ml-auto text-[10px] font-medium text-slate-400">
          XLSX
        </span>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="w-7 shrink-0 border-r border-slate-200 bg-slate-50 pt-6 text-center text-[9px] font-medium text-slate-400">
          {rows.map((_, index) => (
            <span key={index} className="block h-5.5 leading-[1.375rem]">
              {index + 1}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div
            className="grid h-6 divide-x divide-slate-200 border-b border-slate-200 bg-slate-50 text-center text-[9px] font-medium text-slate-400"
            style={grid}
          >
            {visibleColumns.map((_, index) => (
              <span key={index} className="leading-6">
                {String.fromCharCode(65 + index)}
              </span>
            ))}
          </div>
          <div
            className="grid divide-x divide-slate-200 bg-emerald-600 text-[10px] font-semibold text-white"
            style={grid}
          >
            {visibleColumns.map((column) => (
              <span key={column} className="truncate px-2 py-1.5">
                {column}
              </span>
            ))}
          </div>
          {rows.map((row, rowIndex) => (
            <div
              key={rowIndex}
              className="grid min-h-5.5 divide-x divide-slate-200 border-b border-slate-100 text-[10px] text-slate-600"
              style={grid}
            >
              {visibleColumns.map((_, columnIndex) => (
                <span key={columnIndex} className="truncate px-2 py-1">
                  {row[columnIndex] ?? ''}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex h-7 shrink-0 items-center border-t border-slate-200 bg-slate-50 px-3 text-[10px] font-medium text-slate-500">
        <span>{artifact.preview.rows?.length ?? 0} rows</span>
        <span className="ml-3">{visibleColumns.length} columns</span>
      </div>
    </div>
  );
}

/** A document-shaped card makes the file type unambiguous before download.
 * The downloadable bytes are still the source of truth, but a portrait page
 * with an explicit DOCX marker prevents a Word result being mistaken for a
 * presentation just because its chat preview is visual. */
function DocumentArtifactCard({ artifact }: { artifact: FileArtifact }) {
  const accent = TEMPLATE_ACCENTS[artifact.template] ?? '#4a7fb5';
  const sections = artifact.preview.sections?.slice(0, 3) ?? [];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-5 text-slate-900 shadow-[0_18px_45px_-24px_rgba(15,23,42,0.45)]">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <span
          className="grid size-6 place-items-center rounded-md text-white"
          style={{ backgroundColor: accent }}
        >
          <FileText className="size-3.5" />
        </span>
        <span className="text-[10px] font-bold tracking-[0.16em] text-slate-500">
          DOCX
        </span>
        <span className="ml-auto text-[10px] font-medium text-slate-400">
          WORD
        </span>
      </div>

      <h2 className="mt-6 line-clamp-3 font-serif text-[clamp(1.35rem,6.4vw,1.65rem)] leading-[1.08] font-semibold text-balance break-words text-slate-900">
        {artifact.preview.title}
      </h2>
      {artifact.preview.subtitle && (
        <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-slate-500">
          {artifact.preview.subtitle}
        </p>
      )}

      <div className="mt-6 space-y-4">
        {sections.map((section, index) => (
          <div key={`${section.heading}-${index}`}>
            <p
              className="text-[10px] font-bold tracking-[0.11em] uppercase"
              style={{ color: accent }}
            >
              {section.heading}
            </p>
            <div className="mt-2 space-y-1.5">
              {section.paragraphs
                .slice(0, 2)
                .map((paragraph, paragraphIndex) => (
                  <p
                    key={paragraphIndex}
                    className="line-clamp-2 text-[11px] leading-relaxed text-slate-500"
                  >
                    {paragraph}
                  </p>
                ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto border-t border-slate-100 pt-3 text-[10px] font-medium text-slate-400">
        {artifact.fileName}
      </div>
    </div>
  );
}

/** The docx viewer's first page: a real cover, not another content page.
 *  The title block sits in the upper third with an accent rule and subtitle,
 *  and everything below stays whitespace — file meta lives on the exported
 *  document itself, and stuffing teasers onto the cover made every page of
 *  the document preview look the same. */
function DocumentCoverPageView({
  artifact,
  index,
  total,
}: {
  artifact: FileArtifact;
  index: number;
  total: number;
}) {
  const accent = TEMPLATE_ACCENTS[artifact.template] ?? '#4a7fb5';

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-5 text-slate-900 shadow-[0_18px_45px_-24px_rgba(15,23,42,0.45)]">
      {/* Same running chip row as the section pages so the deck reads as one
          document. */}
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <span
          className="grid size-6 place-items-center rounded-md text-white"
          style={{ backgroundColor: accent }}
        >
          <FileText className="size-3.5" />
        </span>
        <span className="text-[10px] font-bold tracking-[0.16em] text-slate-500">
          DOCX
        </span>
        <span className="ml-auto text-[10px] font-medium text-slate-400 tabular-nums">
          {index + 1} / {total}
        </span>
      </div>

      {/* Title block in the upper third; the remaining height is the cover's
          intentional blank space. */}
      <div className="pt-[18%]">
        <p
          className="text-[9px] font-bold tracking-[0.24em] uppercase"
          style={{ color: accent }}
        >
          {m['file_studio.tool.docx_short']()}
        </p>
        <h2 className="mt-4 line-clamp-3 font-serif text-[clamp(1.45rem,7.2vw,1.9rem)] leading-[1.12] font-semibold text-balance break-words text-slate-900">
          {artifact.preview.title}
        </h2>
        <span
          className="mt-5 block h-[3px] w-10 rounded-full"
          style={{ backgroundColor: accent }}
        />
        {artifact.preview.subtitle && (
          <p className="mt-5 max-w-[85%] text-xs leading-relaxed text-slate-500">
            {artifact.preview.subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

/** One page of the right-side viewer: the cover, a document section page,
 *  a deck slide, or a chunk of spreadsheet rows. */
type ContentPage =
  | { type: 'cover' }
  | { type: 'list'; title: string; body: string[] }
  | {
      type: 'presentation';
      layout: Exclude<PresentationPreviewLayout, 'cover'>;
      title: string;
      body: string[];
    }
  | { type: 'table'; columns: string[]; rows: Array<Array<string | number>> };

const TABLE_PAGE_ROWS = 8;
const PRESENTATION_FALLBACK_LAYOUTS: Array<
  Exclude<PresentationPreviewLayout, 'cover'>
> = ['statement', 'cards', 'split', 'flow', 'bullets', 'closing'];

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
    const pages: ContentPage[] = [];
    const rows = preview.rows ?? [];
    for (let i = 0; i < rows.length; i += TABLE_PAGE_ROWS) {
      pages.push({
        type: 'table',
        columns: preview.columns ?? [],
        rows: rows.slice(i, i + TABLE_PAGE_ROWS),
      });
    }
    return pages.length
      ? pages
      : [{ type: 'table', columns: preview.columns ?? [], rows: [] }];
  }

  const slides = preview.slides ?? [];
  if (!slides.length) return [{ type: 'cover' }];

  return slides.map((slide, index): ContentPage => {
    if (index === 0) return { type: 'cover' };
    const layout =
      slide.layout && slide.layout !== 'cover'
        ? slide.layout
        : PRESENTATION_FALLBACK_LAYOUTS[
            (index - 1) % PRESENTATION_FALLBACK_LAYOUTS.length
          ];
    return {
      type: 'presentation',
      layout,
      title: slide.title,
      body: slide.body,
    };
  });
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

/* Cross-tree signal: while a file viewer is open, the host page narrows its
 * column so the panel sits BESIDE the chat (composer included) instead of
 * over it. The panel renders per-turn through a portal, so a tiny store is
 * the only way its open state can reach the page shell. Refcounted because
 * several turns each own a panel. */
let openPreviewCount = 0;
const previewCountSubscribers = new Set<() => void>();

function notifyPreviewCount() {
  for (const subscriber of previewCountSubscribers) subscriber();
}

export function useFilePreviewOpen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      previewCountSubscribers.add(onChange);
      return () => {
        previewCountSubscribers.delete(onChange);
      };
    },
    () => openPreviewCount > 0,
    // File viewers only exist after a user opens a generated artifact in the
    // browser. The deterministic server value prevents React from abandoning
    // SSR with "Missing getServerSnapshot" before the page hydrates.
    () => false
  );
}

/* Side-panel width, shared with the host shells through the --file-preview-w
 * CSS variable on <html>: the drawer and the shells' ceded padding all read
 * the same var, so dragging the divider resizes both with zero re-renders.
 * Unset = the 36rem fallback everywhere (the pre-resize default). The CSS
 * side additionally caps the rendered width at viewport − 560px (see the
 * min() in the panel and shells), which is exactly what previewWidthMax()
 * clamps drags to — JS and CSS never disagree. */
const PREVIEW_WIDTH_MIN = 384;
const PREVIEW_WIDTH_DEFAULT = 36 * 16;
const PREVIEW_WIDTH_MAX_PX = 960;
/** Keep at least ~560px of chat visible beside the panel. */
function previewWidthMax(): number {
  return Math.max(
    PREVIEW_WIDTH_MIN,
    Math.min(window.innerWidth - 560, PREVIEW_WIDTH_MAX_PX)
  );
}
function readPreviewWidthPx(): number {
  const parsed = parseFloat(
    document.documentElement.style.getPropertyValue('--file-preview-w')
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : PREVIEW_WIDTH_DEFAULT;
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
  const isSpreadsheet = artifact.preview.kind === 'xlsx';
  const isDocument = artifact.preview.kind === 'docx';
  const scrollRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  // 1-based page nearest the viewport center; ref copy keeps the keyboard
  // handler reading fresh values without re-subscribing on every scroll.
  const [current, setCurrent] = useState(1);
  const currentRef = useRef(1);

  // Each open starts on the same first page shown by the chat card. The
  // browser can restore a scroll position after the portal is remounted, and
  // scroll snapping can then land the viewer on a later section; reset once
  // after layout as well so the cover is always the first thing the reader
  // sees.
  useEffect(() => {
    if (!open) return;
    currentRef.current = 1;
    setCurrent(1);
    const resetToCover = () => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      scroller.scrollTo({ top: 0, behavior: 'auto' });
      scroller.scrollTop = 0;
    };
    resetToCover();
    const frame = window.requestAnimationFrame(resetToCover);
    const timer = window.setTimeout(resetToCover, 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [open]);

  // Tell the host page to make room — on wide screens the shell narrows so
  // this panel lands beside the chat rather than over the composer.
  useEffect(() => {
    if (!open) return;
    openPreviewCount += 1;
    notifyPreviewCount();
    return () => {
      openPreviewCount = Math.max(0, openPreviewCount - 1);
      notifyPreviewCount();
    };
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

  /* Dragging the left edge resizes the panel (xl+ only — below that it's a
   * full-width overlay with nothing to resize against). The width rides the
   * --file-preview-w variable, which the host shells also read as their
   * ceded padding, so the chat column follows the cursor in lockstep. */
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const onDividerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: readPreviewWidthPx(),
    };
    // Suspend the shells' padding transition for the duration (see globals.css).
    document.documentElement.classList.add('file-preview-resizing');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };
  const onDividerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const next = Math.round(
      Math.min(
        Math.max(
          drag.startWidth - (event.clientX - drag.startX),
          PREVIEW_WIDTH_MIN
        ),
        previewWidthMax()
      )
    );
    document.documentElement.style.setProperty('--file-preview-w', `${next}px`);
  };
  const onDividerPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || event.pointerId !== dragRef.current.pointerId)
      return;
    dragRef.current = null;
    document.documentElement.classList.remove('file-preview-resizing');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };
  /** Double-click the divider: back to the 36rem default. */
  const onDividerReset = () => {
    dragRef.current = null;
    document.documentElement.classList.remove('file-preview-resizing');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    document.documentElement.style.removeProperty('--file-preview-w');
  };

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
    <div
      className="fixed inset-0 z-50 lg:pointer-events-none"
      role="dialog"
      aria-modal="true"
    >
      {/* Below lg (1024px) there is no room for chat + panel side by side,
          so the viewer is a classic overlay (dim + click-outside to close).
          From lg up it becomes a side panel: no dim, clicks pass through to
          the chat — the shell's ceded padding (the same width expression)
          keeps the composer clear of the panel. The min() caps the panel at
          viewport − 560px so a laptop window that sits under the old 1280px
          threshold still keeps a ≥560px chat column beside it. */}
      <div
        className="animate-in fade-in-0 absolute inset-0 bg-black/40 backdrop-blur-[2px] lg:bg-transparent lg:backdrop-blur-none"
        onClick={onClose}
      />
      {/* Pure-white paper backdrop. The token overrides pin every
          `foreground`-derived utility inside to dark ink on white, so the
          viewer reads as a white page in dark mode too. */}
      <div className="border-foreground/10 animate-in slide-in-from-right absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l bg-white shadow-2xl duration-300 [--background:#ffffff] [--foreground:#2e2e2b] lg:pointer-events-auto lg:w-[min(var(--file-preview-w,36rem),calc(100vw-560px))] lg:max-w-none">
        {/* The panel's left edge doubles as the resize divider: drag to
            resize, double-click to snap back to the default width. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={m['file_studio.preview.resize']()}
          title={m['file_studio.preview.resize']()}
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerEnd}
          onPointerCancel={onDividerPointerEnd}
          onDoubleClick={onDividerReset}
          className="group absolute inset-y-0 -left-1.5 z-20 hidden w-3 cursor-col-resize touch-none select-none lg:block"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/10 transition-colors group-hover:bg-black/40" />
        </div>
        <header className="border-foreground/10 flex h-14 shrink-0 items-center gap-3 border-b px-4">
          {/* The live page counter is the header's only metadata — the chat
              card already names the file, so icon + filename are gone. */}
          <p className="text-foreground/60 min-w-0 flex-1 truncate text-xs tabular-nums">
            {current} / {pages.length}
          </p>
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
          className="flex min-h-0 snap-y snap-proximity flex-col overflow-y-auto p-4 pb-10 sm:p-6"
        >
          {/* Auto margins center the page stack vertically when it is shorter
              than the panel (a lone spreadsheet page leaves a huge dead band
              at the bottom otherwise) and collapse to zero once the stack
              overflows — unlike justify-center, no page ends up unreachable
              above the fold. */}
          <div className="m-auto flex w-full flex-col items-center gap-5 sm:gap-6">
            {pages.map((page, index) => (
              <div
                key={index}
                ref={(node) => {
                  slideRefs.current[index] = node;
                }}
                className={cn(
                  'w-full shrink-0 snap-center',
                  isSpreadsheet
                    ? 'aspect-[4/3] max-w-[500px]'
                    : isDocument
                      ? 'aspect-[0.72] max-w-[320px] sm:max-w-[350px]'
                      : 'aspect-video max-w-[440px]'
                )}
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
  'blue-professional': '#1e2bfa',
  'creative-mode': '#e85a1f',
  vellum: '#3a7878',
  'dark-botanical': '#d4a574',
  'notebook-tabs': '#98d4bb',
  'neon-cyber': '#00ffcc',
  'swiss-modern': '#ff3300',
  'paper-ink': '#c41e3a',
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
  if (page.type === 'cover') {
    return artifact.preview.kind === 'docx' ? (
      <DocumentCoverPageView artifact={artifact} index={index} total={total} />
    ) : (
      <PresentationCover artifact={artifact} />
    );
  }
  if (page.type === 'table') {
    return (
      <TablePageView
        artifact={artifact}
        page={page}
        index={index}
        total={total}
      />
    );
  }
  if (page.type === 'presentation') {
    return (
      <PresentationPageView
        artifact={artifact}
        page={page}
        index={index}
        total={total}
      />
    );
  }
  // 'list' pages are document sections — keep the white Word styling the
  // cover established instead of switching to the deck's editorial slides.
  return (
    <DocumentSectionPageView
      artifact={artifact}
      page={page}
      index={index}
      total={total}
    />
  );
}

type PresentationPreviewTheme = {
  background: string;
  ink: string;
  muted: string;
  primary: string;
  secondary: string;
  paper: string;
  displayFont: string;
};

/** The preview shares the three chosen deck systems, not a generic office
 * theme. These are deliberately tied to the same systems used by the PPTX
 * renderer and gallery. */
function presentationPreviewTheme(
  template: FileTemplate
): PresentationPreviewTheme {
  if (template === 'creative-mode') {
    return {
      background: '#efe9d9',
      ink: '#101010',
      muted: '#6a6459',
      primary: '#1f8a4c',
      secondary: '#f06ca8',
      paper: '#f7f1e4',
      displayFont: 'ui-sans-serif, system-ui, sans-serif',
    };
  }
  if (template === 'vellum') {
    return {
      background: '#2a3870',
      ink: '#f2e77b',
      muted: '#b9b36e',
      primary: '#e8d85c',
      secondary: '#3a7878',
      paper: '#34427c',
      displayFont: 'Georgia, "Times New Roman", serif',
    };
  }
  if (template === 'blue-professional') {
    return {
      background: '#fdfae7',
      ink: '#111111',
      muted: '#68675e',
      primary: '#1e2bfa',
      secondary: '#e3e7ff',
      paper: '#fffdf1',
      displayFont: 'ui-sans-serif, system-ui, sans-serif',
    };
  }
  if (template === 'dark-botanical') {
    return {
      background: '#0f0f0f',
      ink: '#e8e4df',
      muted: '#9a9590',
      primary: '#d4a574',
      secondary: '#3b2d2e',
      paper: '#1a1918',
      displayFont: 'Georgia, "Times New Roman", serif',
    };
  }
  if (template === 'notebook-tabs') {
    return {
      background: '#2d2d2d',
      ink: '#1a1a1a',
      muted: '#68645d',
      primary: '#5a7c6a',
      secondary: '#f8f6f1',
      paper: '#f8f6f1',
      displayFont: 'Georgia, "Times New Roman", serif',
    };
  }
  if (template === 'neon-cyber') {
    return {
      background: '#0a0f1c',
      ink: '#effffb',
      muted: '#82a6b7',
      primary: '#00ffcc',
      secondary: '#ff00aa',
      paper: '#0d1728',
      displayFont: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    };
  }
  if (template === 'swiss-modern') {
    return {
      background: '#ffffff',
      ink: '#111111',
      muted: '#575757',
      primary: '#ff3300',
      secondary: '#f0efec',
      paper: '#ffffff',
      displayFont: 'ui-sans-serif, system-ui, sans-serif',
    };
  }
  if (template === 'paper-ink') {
    return {
      background: '#faf9f7',
      ink: '#1a1a1a',
      muted: '#69605b',
      primary: '#c41e3a',
      secondary: '#eadfd7',
      paper: '#fffdf9',
      displayFont: 'Georgia, "Times New Roman", serif',
    };
  }
  return {
    background: '#f2efe6',
    ink: '#1a1a1a',
    muted: '#65615a',
    primary: TEMPLATE_ACCENTS[template] ?? '#4a7fb5',
    secondary: '#e5e1d6',
    paper: '#faf8f2',
    displayFont: 'ui-sans-serif, system-ui, sans-serif',
  };
}

function deckTitleParts(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return {
    lead: words.length > 1 ? words[0] : '',
    rest: words.length > 1 ? words.slice(1).join(' ') : title,
  };
}

/** Actual cover preview for the presentation—not the old generic artifact
 * cover used for document/spreadsheet results. */
function PresentationCover({ artifact }: { artifact: FileArtifact }) {
  const theme = presentationPreviewTheme(artifact.template);
  const { lead, rest } = deckTitleParts(artifact.preview.title);
  const subtitle = coverTagline(artifact);
  const isVellum = artifact.template === 'vellum';
  const isCreative = artifact.template === 'creative-mode';
  const isBotanical = artifact.template === 'dark-botanical';
  const isNotebook = artifact.template === 'notebook-tabs';
  const isNeon = artifact.template === 'neon-cyber';
  const isSwiss = artifact.template === 'swiss-modern';
  const isPaperInk = artifact.template === 'paper-ink';

  return (
    <div
      className="relative flex h-full w-full overflow-hidden rounded-lg p-[6%] shadow-[0_18px_45px_-18px_rgba(0,0,0,0.4)] ring-1 ring-black/10"
      style={{ background: theme.background, color: theme.ink }}
    >
      {artifact.template === 'blue-professional' && (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-y-0 right-0 w-[29%]"
            style={{ background: theme.secondary }}
          />
          <div
            aria-hidden="true"
            className="absolute top-[16%] right-[8%] size-[21%] rounded-full border-[3px]"
            style={{ borderColor: theme.primary }}
          />
          <div
            aria-hidden="true"
            className="absolute right-0 bottom-0 h-[62%] w-[22%]"
            style={{ background: theme.primary }}
          />
        </>
      )}
      {isCreative && (
        <>
          <div
            aria-hidden="true"
            className="absolute top-[10%] right-[9%] h-[76%] w-[22%] border-[3px]"
            style={{ background: theme.primary, borderColor: theme.ink }}
          />
          <div
            aria-hidden="true"
            className="absolute top-[35%] right-[13%] h-[19%] w-[14%] border-[3px]"
            style={{ background: theme.secondary, borderColor: theme.ink }}
          />
          <div
            aria-hidden="true"
            className="absolute right-[12%] bottom-[23%] h-[6%] w-[15%] border-[3px] bg-[#f5c518]"
            style={{ borderColor: theme.ink }}
          />
        </>
      )}
      {isVellum && (
        <>
          <div
            aria-hidden="true"
            className="absolute -top-[16%] right-[3%] size-[44%] rounded-full"
            style={{ background: theme.secondary }}
          />
          <div
            aria-hidden="true"
            className="absolute right-[11%] bottom-[16%] h-px w-[38%]"
            style={{ background: theme.primary }}
          />
        </>
      )}
      {isBotanical && (
        <>
          <div
            aria-hidden="true"
            className="absolute -top-[17%] right-[-4%] size-[49%] rounded-full opacity-55"
            style={{ background: theme.secondary }}
          />
          <div
            aria-hidden="true"
            className="absolute top-[10%] right-[9%] size-[31%] rounded-full opacity-65"
            style={{ background: theme.primary }}
          />
          <div
            aria-hidden="true"
            className="absolute top-[17%] bottom-[14%] left-[6%] w-px"
            style={{ background: theme.primary }}
          />
        </>
      )}
      {isNotebook && (
        <>
          <div
            aria-hidden="true"
            className="absolute top-[5%] right-[8%] bottom-[5%] left-[7%] rounded-[4px] shadow-[0_8px_18px_rgba(0,0,0,0.22)]"
            style={{ background: theme.paper }}
          />
          {['#98d4bb', '#c7b8ea', '#f4b8c5', '#a8d8ea', '#ffe6a7'].map(
            (color, index) => (
              <div
                key={color}
                aria-hidden="true"
                className="absolute right-[3%] h-[9%] w-[10%] rounded-r-[4px]"
                style={{ top: `${15 + index * 13}%`, background: color }}
              />
            )
          )}
          {[26, 44, 62].map((top) => (
            <span
              key={top}
              aria-hidden="true"
              className="absolute left-[9%] size-[7px] rounded-full bg-black/25"
              style={{ top: `${top}%` }}
            />
          ))}
        </>
      )}
      {isNeon && (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                'linear-gradient(rgba(0,255,204,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,204,.35) 1px, transparent 1px)',
              backgroundSize: '9% 14%',
            }}
          />
          <div
            aria-hidden="true"
            className="absolute top-[11%] right-[8%] bottom-[11%] left-[8%] border"
            style={{ borderColor: theme.primary, background: '#0d1728' }}
          />
          <div
            aria-hidden="true"
            className="absolute right-[13%] bottom-[17%] size-[20%] rounded-full border-[3px]"
            style={{ borderColor: theme.secondary }}
          />
        </>
      )}
      {isSwiss && (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-[24%]"
            style={{ background: theme.primary }}
          />
          <div
            aria-hidden="true"
            className="absolute top-[11%] right-[9%] size-[21%] rounded-full bg-black"
          />
          <span
            aria-hidden="true"
            className="absolute bottom-[9%] left-[5%] text-[2.6rem] leading-none font-black text-white"
          >
            01
          </span>
        </>
      )}
      {isPaperInk && (
        <>
          <div
            aria-hidden="true"
            className="absolute top-[11%] right-[7%] left-[7%] h-px"
            style={{ background: theme.primary }}
          />
          <div
            aria-hidden="true"
            className="absolute right-[7%] bottom-[16%] left-[7%] h-px"
            style={{ background: theme.primary, opacity: 0.55 }}
          />
          <span
            aria-hidden="true"
            className="absolute top-[43%] left-[8%] font-serif text-[5rem] leading-none"
            style={{ color: theme.primary, opacity: 0.25 }}
          >
            “
          </span>
        </>
      )}

      <div
        className={cn(
          'relative z-10 flex min-w-0 flex-1 flex-col',
          isNotebook && 'ml-[9%] max-w-[70%]'
        )}
      >
        <div className="flex items-center gap-2">
          <span className="h-[3px] w-7" style={{ background: theme.primary }} />
          <span
            className="text-[0.5rem] font-bold tracking-[0.28em] uppercase"
            style={{ color: theme.muted }}
          >
            Presentation
          </span>
        </div>
        <div className="mt-[10%] max-w-[70%]">
          {lead && (
            <p
              className="text-[0.85rem] tracking-[0.13em]"
              style={{ color: theme.primary, fontFamily: theme.displayFont }}
            >
              {lead}
            </p>
          )}
          <h2
            className="mt-1 line-clamp-3 text-[2rem] leading-[0.95] font-semibold text-balance"
            style={{ fontFamily: theme.displayFont }}
          >
            {rest}
          </h2>
          {subtitle && (
            <p
              className="mt-3 line-clamp-2 text-[0.57rem] leading-relaxed font-bold tracking-[0.1em] uppercase"
              style={{ color: theme.muted }}
            >
              {subtitle}
            </p>
          )}
        </div>
        <div className="mt-auto flex items-center gap-3 text-[0.52rem] font-semibold">
          <span style={{ color: theme.muted }}>{artifact.fileName}</span>
          <span className="h-px flex-1" style={{ background: theme.muted }} />
          <span style={{ color: theme.primary }}>
            {fileCountLabel(artifact)}
          </span>
        </div>
      </div>
    </div>
  );
}

function PresentationFrame({
  artifact,
  index,
  total,
  children,
}: {
  artifact: FileArtifact;
  index: number;
  total: number;
  children: React.ReactNode;
}) {
  const theme = presentationPreviewTheme(artifact.template);
  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-lg p-[5.5%] shadow-[0_18px_45px_-18px_rgba(0,0,0,0.4)] ring-1 ring-black/10"
      style={{ background: theme.background, color: theme.ink }}
    >
      <div className="flex items-center gap-2">
        <span className="h-[3px] w-7" style={{ background: theme.primary }} />
        <span
          className="text-[0.52rem] font-bold tracking-[0.26em]"
          style={{ color: theme.muted }}
        >
          {String(index + 1).padStart(2, '0')}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
      <span
        className="mt-2 text-right text-[0.52rem] font-semibold tracking-[0.18em]"
        style={{ color: theme.muted }}
      >
        {index + 1} / {total}
      </span>
    </div>
  );
}

/** Renders each stored presentation layout differently. The list renderer is
 * now retained only for DOCX sections; PPT previews mirror the deck plan. */
function PresentationPageView({
  artifact,
  page,
  index,
  total,
}: {
  artifact: FileArtifact;
  page: Extract<ContentPage, { type: 'presentation' }>;
  index: number;
  total: number;
}) {
  const theme = presentationPreviewTheme(artifact.template);
  const items = page.body.length ? page.body : [page.title];
  const title = page.title;

  if (page.layout === 'statement') {
    return (
      <PresentationFrame artifact={artifact} index={index} total={total}>
        <div className="flex h-full items-center justify-center px-[11%] text-center">
          <div>
            <span
              className="block text-[3.8rem] leading-none"
              style={{ color: theme.primary, fontFamily: theme.displayFont }}
            >
              “
            </span>
            <h2
              className="-mt-4 text-[1.85rem] leading-[1.04] font-semibold text-balance"
              style={{ fontFamily: theme.displayFont }}
            >
              {title}
            </h2>
            <p
              className="mt-4 line-clamp-3 text-[0.76rem] leading-relaxed"
              style={{ color: theme.muted }}
            >
              {items[0]}
            </p>
          </div>
        </div>
      </PresentationFrame>
    );
  }

  if (page.layout === 'cards') {
    return (
      <PresentationFrame artifact={artifact} index={index} total={total}>
        <h2
          className="mt-[5%] max-w-[78%] text-[1.65rem] leading-[1.02] font-semibold text-balance"
          style={{ fontFamily: theme.displayFont }}
        >
          {title}
        </h2>
        <div className="mt-[7%] grid grid-cols-3 gap-[3%]">
          {items.slice(0, 3).map((item, itemIndex) => (
            <article
              key={`${item}-${itemIndex}`}
              className="min-w-0 rounded-[8px] border p-[7%]"
              style={{ background: theme.paper, borderColor: theme.secondary }}
            >
              <span
                className="text-[0.62rem] font-bold"
                style={{ color: theme.primary }}
              >
                0{itemIndex + 1}
              </span>
              <p className="mt-3 line-clamp-4 text-[0.62rem] leading-relaxed">
                {item}
              </p>
            </article>
          ))}
        </div>
      </PresentationFrame>
    );
  }

  if (page.layout === 'split') {
    return (
      <PresentationFrame artifact={artifact} index={index} total={total}>
        <div className="mt-[6%] grid h-[78%] grid-cols-[0.9fr_1.1fr] gap-[7%]">
          <div
            className="relative overflow-hidden rounded-[10px] p-[9%]"
            style={{ background: theme.secondary }}
          >
            <span
              className="absolute -right-[16%] -bottom-[29%] text-[9rem] leading-none font-bold"
              style={{ color: theme.primary, opacity: 0.22 }}
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <h2
              className="relative z-10 text-[1.45rem] leading-[1.03] font-semibold text-balance"
              style={{ fontFamily: theme.displayFont }}
            >
              {title}
            </h2>
          </div>
          <div className="flex min-w-0 flex-col justify-center gap-3">
            {items.slice(0, 4).map((item, itemIndex) => (
              <div
                key={`${item}-${itemIndex}`}
                className="border-b pb-2 text-[0.7rem] leading-relaxed"
                style={{ borderColor: theme.secondary, color: theme.muted }}
              >
                <span
                  className="mr-2 font-bold"
                  style={{ color: theme.primary }}
                >
                  0{itemIndex + 1}
                </span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </PresentationFrame>
    );
  }

  if (page.layout === 'flow') {
    return (
      <PresentationFrame artifact={artifact} index={index} total={total}>
        <h2
          className="mt-[5%] max-w-[78%] text-[1.65rem] leading-[1.02] font-semibold text-balance"
          style={{ fontFamily: theme.displayFont }}
        >
          {title}
        </h2>
        <div className="mt-[12%] flex items-center gap-2">
          {items.slice(0, 4).map((item, itemIndex) => (
            <div
              key={`${item}-${itemIndex}`}
              className="flex min-w-0 flex-1 items-center gap-2"
            >
              <div
                className="flex aspect-square min-w-0 flex-1 items-center justify-center rounded-full p-[13%] text-center"
                style={{
                  background: itemIndex % 2 ? theme.secondary : theme.primary,
                  color: itemIndex % 2 ? theme.ink : theme.background,
                }}
              >
                <span className="line-clamp-4 text-[0.58rem] leading-tight font-semibold">
                  {item}
                </span>
              </div>
              {itemIndex < Math.min(items.length, 4) - 1 && (
                <span className="text-[1rem]" style={{ color: theme.primary }}>
                  →
                </span>
              )}
            </div>
          ))}
        </div>
      </PresentationFrame>
    );
  }

  if (page.layout === 'closing') {
    return (
      <PresentationFrame artifact={artifact} index={index} total={total}>
        <div className="relative flex h-full items-center justify-center overflow-hidden text-center">
          <span
            aria-hidden="true"
            className="absolute size-[58%] rounded-full"
            style={{ background: theme.secondary, opacity: 0.72 }}
          />
          <div className="relative z-10 max-w-[72%]">
            <p
              className="text-[0.62rem] font-bold tracking-[0.2em] uppercase"
              style={{ color: theme.primary }}
            >
              Next step
            </p>
            <h2
              className="mt-3 text-[2rem] leading-[1.02] font-semibold text-balance"
              style={{ fontFamily: theme.displayFont }}
            >
              {title}
            </h2>
            {items[0] && (
              <p
                className="mt-4 text-[0.75rem] leading-relaxed"
                style={{ color: theme.muted }}
              >
                {items[0]}
              </p>
            )}
          </div>
        </div>
      </PresentationFrame>
    );
  }

  return (
    <PresentationFrame artifact={artifact} index={index} total={total}>
      <h2
        className="mt-[5%] max-w-[76%] text-[1.7rem] leading-[1.02] font-semibold text-balance"
        style={{ fontFamily: theme.displayFont }}
      >
        {title}
      </h2>
      <div className="mt-[8%] grid gap-3">
        {items.slice(0, 4).map((item, itemIndex) => (
          <div
            key={`${item}-${itemIndex}`}
            className="flex items-start gap-3 border-b pb-2"
            style={{ borderColor: theme.secondary }}
          >
            <span
              className="text-[0.66rem] font-bold"
              style={{ color: theme.primary }}
            >
              0{itemIndex + 1}
            </span>
            <p
              className="text-[0.72rem] leading-relaxed"
              style={{ color: theme.muted }}
            >
              {item}
            </p>
          </div>
        ))}
      </div>
    </PresentationFrame>
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
                className="block text-[1.15rem] tracking-[0.14em] break-words"
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
 * A document section page — the viewer's continuation of the white Word card
 * that opens it. Documents must not switch to the presentation's editorial
 * slides after the cover: background, palette, and prose stay one continuous
 * file, so the preview reads like the DOCX it downloads as.
 */
/** Chinese numerals for CJK sections, zero-padded Arabic elsewhere — same
 *  convention the DOCX renderer stamps into the exported headings. */
function documentSectionLabel(ordinal: number, cjk: boolean): string {
  const numerals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  if (cjk && ordinal <= 10) return `${numerals[ordinal - 1]}、`;
  return `${String(ordinal).padStart(2, '0')} · `;
}

function DocumentSectionPageView({
  artifact,
  page,
  index,
  total,
}: {
  artifact: FileArtifact;
  page: { title: string; body: string[] };
  index: number;
  total: number;
}) {
  const accent = TEMPLATE_ACCENTS[artifact.template] ?? '#4a7fb5';
  const cjkSection = /[一-鿿]/.test(page.title);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-5 text-slate-900 shadow-[0_18px_45px_-24px_rgba(15,23,42,0.45)]">
      {/* Same running header as the cover card — icon chip + DOCX — with the
          page counter in the WORD slot. */}
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <span
          className="grid size-6 place-items-center rounded-md text-white"
          style={{ backgroundColor: accent }}
        >
          <FileText className="size-3.5" />
        </span>
        <span className="text-[10px] font-bold tracking-[0.16em] text-slate-500">
          DOCX
        </span>
        <span className="ml-auto text-[10px] font-medium text-slate-400 tabular-nums">
          {index + 1} / {total}
        </span>
      </div>

      {/* The section number mirrors the exported document's heading marks —
          without it every page opened on the same anonymous title. */}
      <p
        className="mt-5 text-[10px] font-bold tracking-[0.2em]"
        style={{ color: accent }}
      >
        {documentSectionLabel(index, cjkSection)}
      </p>
      <h2 className="mt-1.5 font-serif text-[1.35rem] leading-[1.15] font-semibold text-balance break-words text-slate-900">
        {page.title}
      </h2>

      {/* Prose, not slide bullets: the section's full paragraphs, clipped
          only by the page's own scroll. Chinese paragraphs get the classic
          two-character first-line indent. */}
      <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto [scrollbar-width:none]">
        {page.body.map((paragraph, paragraphIndex) => (
          <p
            key={paragraphIndex}
            className={cn(
              'text-[11px] leading-[1.75] break-words text-slate-600',
              /[一-鿿]/.test(paragraph) && 'text-justify indent-8'
            )}
          >
            {paragraph}
          </p>
        ))}
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3 text-[10px] font-medium text-slate-400">
        <span className="block truncate">{artifact.fileName}</span>
      </div>
    </div>
  );
}

/** A spreadsheet page in the viewer: the same white workbook chrome as the
 *  chat card — title bar, column-letter ruler, row-number gutter, accent
 *  header row — scaled up to page size. The beige editorial paper used to
 *  make a generated table read as a deck slide instead of a workbook. */
function TablePageView({
  artifact,
  page,
  index,
  total,
}: {
  artifact: FileArtifact;
  page: { columns: string[]; rows: Array<Array<string | number>> };
  index: number;
  total: number;
}) {
  const columns = page.columns.length ? page.columns : [''];
  const grid = {
    gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
  };
  // Pages chunk the workbook sequentially, so the page index gives the
  // global row number — the gutter must match Excel's numbering.
  const startRow = index * TABLE_PAGE_ROWS;
  const totalRows = artifact.preview.rows?.length ?? 0;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-[0_18px_45px_-24px_rgba(15,23,42,0.45)]">
      {/* Same title bar as the chat card so card and viewer read as one
          workbook. */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3.5">
        <span className="grid size-5.5 place-items-center rounded bg-emerald-600 text-white">
          <Table2 className="size-3" />
        </span>
        <span className="min-w-0 truncate text-xs font-semibold text-slate-700">
          {artifact.preview.title}
        </span>
        <span className="ml-auto text-[10px] font-medium text-slate-400 tabular-nums">
          {index + 1} / {total}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Letter ruler across the data columns; the row-number lane is a
            fixed spacer of the same width so every strip shares one grid. */}
        <div className="flex shrink-0 border-b border-slate-200 bg-slate-50">
          <span className="w-8 shrink-0 border-r border-slate-200" />
          <div
            className="grid h-7 min-w-0 flex-1 divide-x divide-slate-200 text-center text-[9px] leading-7 font-medium text-slate-400"
            style={grid}
          >
            {columns.map((_, columnIndex) => (
              <span key={columnIndex}>
                {String.fromCharCode(65 + (columnIndex % 26))}
              </span>
            ))}
          </div>
        </div>
        {/* Accent header row: workbook identity, same as the chat card. */}
        <div className="flex shrink-0 bg-emerald-600 text-[11px] font-semibold text-white">
          <span className="w-8 shrink-0 border-r border-emerald-700/40 bg-slate-50" />
          <div
            className="grid min-w-0 flex-1 divide-x divide-white/20"
            style={grid}
          >
            {columns.map((column) => (
              <span key={column} className="truncate px-2.5 leading-8">
                {column}
              </span>
            ))}
          </div>
        </div>
        {/* Each data row carries its own number cell, so numbers stay
            centered no matter how many lines a verbatim cell wraps to. */}
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
          {page.rows.map((row, rowIndex) => (
            <div
              key={rowIndex}
              className="flex min-h-7 border-b border-slate-100 text-[11px] text-slate-600"
            >
              <span className="flex w-8 shrink-0 items-center justify-center border-r border-slate-200 bg-slate-50 text-[9px] font-medium text-slate-400 tabular-nums">
                {startRow + rowIndex + 1}
              </span>
              <div
                className="grid min-w-0 flex-1 divide-x divide-slate-200"
                style={grid}
              >
                {columns.map((_, columnIndex) => (
                  <span
                    key={columnIndex}
                    className="px-2.5 py-1.5 leading-relaxed break-words"
                  >
                    {row[columnIndex] ?? ''}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex h-8 shrink-0 items-center border-t border-slate-200 bg-slate-50 px-3.5 text-[10px] font-medium text-slate-500">
        <span>{totalRows} rows</span>
        <span className="ml-3">{columns.length} columns</span>
        <span className="ml-auto tabular-nums">
          {Math.min(startRow + 1, totalRows)}–
          {Math.min(startRow + page.rows.length, totalRows)} / {totalRows}
        </span>
      </div>
    </div>
  );
}
