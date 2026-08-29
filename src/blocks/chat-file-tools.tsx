import { useState } from 'react';
import {
  Check,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Presentation,
  Table2,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export type FileKind = 'pptx' | 'docx' | 'xlsx';
export type FileTemplate = 'business' | 'modern' | 'minimal' | 'creative';

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
 * "Create files" glyph for the composer trigger — a document with a second
 * page peeking behind it (the PPT / Word / Excel outputs the menu generates),
 * and a four-point sparkle inside as the AI-generated content. Drawn in
 * lucide's stroke style so it sits next to Plus and Columns2 in the toolbar.
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
      {/* back page peeking behind the front one */}
      <path d="M6 2h6l4 4v3" />
      {/* front page with a folded corner */}
      <path d="M5 7h5.5L15 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
      <path d="M10.5 7V11.5H15" />
      {/* sparkle as the page's generated content */}
      <path d="M9.2 13.5Q10.3 14.9 11.7 16Q10.3 17.1 9.2 18.5Q8.1 17.1 6.7 16Q8.1 14.9 9.2 13.5Z" />
    </svg>
  );
}

/** The exact three-item tool picker from the Lorka-style chat composer. */
export function ChatFileToolPicker({
  value,
  onChange,
  disabled,
  compact = false,
}: {
  value: FileKind | null;
  onChange: (kind: FileKind | null) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tools = getTools();
  const active = tools.find((tool) => tool.kind === value);
  const ActiveIcon = active?.icon;

  if (active) {
    return (
      <div className="text-foreground/70 bg-foreground/[0.05] flex h-9 shrink-0 items-center gap-1 rounded-lg pr-1 pl-2 text-xs font-medium">
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'text-foreground/65 hover:bg-foreground/5 hover:text-foreground inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-45',
          compact ? 'size-9' : 'px-2'
        )}
        aria-label={m['file_studio.create']()}
        title={m['file_studio.create']()}
      >
        <CreateFileIcon className="size-4" />
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

const GALLERY_TEMPLATES: Array<{
  id: FileTemplate;
  color: string;
  corner: string;
}> = [
  { id: 'business', color: '#2563eb', corner: '#183f7a' },
  { id: 'modern', color: '#7c3aed', corner: '#4c1d95' },
  { id: 'minimal', color: '#525252', corner: '#18181b' },
  { id: 'creative', color: '#db2777', corner: '#831843' },
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
    <section className="mt-6 w-full pt-5 text-left">
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
          <div className="mt-2.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {GALLERY_TEMPLATES.map((template) => {
              const selected = value === template.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onTemplateChange(template.id)}
                  className={cn(
                    'group bg-card relative overflow-hidden rounded-2xl border p-2 text-left transition-all',
                    selected
                      ? 'border-foreground/55 ring-foreground/10 ring-2'
                      : 'border-foreground/10 hover:border-foreground/30 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5'
                  )}
                >
                  <TemplateThumbnail
                    kind={kind}
                    color={template.color}
                    corner={template.corner}
                  />
                  <span className="mt-1.5 flex items-center justify-between text-[13px] font-medium">
                    {templateLabel(template.id)}
                    {selected && <Check className="size-3.5" />}
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

function TemplateThumbnail({
  kind,
  color,
  corner,
}: {
  kind: FileKind;
  color: string;
  corner: string;
}) {
  if (kind === 'xlsx') {
    return (
      <div className="relative grid aspect-[1.45] grid-cols-4 overflow-hidden rounded-xl border border-black/10 bg-white text-[6px]">
        <span
          className="col-span-4 flex items-center px-1.5 font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          SHEET
        </span>
        {Array.from({ length: 12 }, (_, index) => (
          <span key={index} className="border-r border-b border-black/[0.07]" />
        ))}
      </div>
    );
  }

  return (
    <div className="relative aspect-[1.45] overflow-hidden rounded-xl border border-black/10 bg-white p-2.5">
      <span
        className="absolute top-0 right-0 block size-7"
        style={{
          background: `linear-gradient(45deg, transparent 49%, ${corner} 50%)`,
        }}
      />
      <span
        className="block h-1.5 w-10 rounded-full"
        style={{ backgroundColor: color }}
      />
      {kind === 'pptx' ? (
        <>
          <span className="mt-2 block h-1.5 w-4/5 rounded bg-black/75" />
          <span className="mt-1.5 block h-1.5 w-full rounded bg-black/15" />
          <span className="mt-1 block h-1.5 w-3/4 rounded bg-black/15" />
          <span className="mt-1 block h-1.5 w-2/3 rounded bg-black/15" />
        </>
      ) : (
        <>
          <span className="mt-2 block h-1.5 w-2/3 rounded bg-black/75" />
          <span className="mt-2 block h-1.5 w-full rounded bg-black/15" />
          <span className="mt-1 block h-1.5 w-full rounded bg-black/15" />
          <span className="mt-1 block h-1.5 w-5/6 rounded bg-black/15" />
        </>
      )}
    </div>
  );
}

export function FileGenerationTurn({
  prompt,
  kind,
  template,
  artifact,
  pending,
}: {
  prompt: string;
  kind: FileKind;
  template: FileTemplate;
  artifact?: FileArtifact;
  pending?: boolean;
}) {
  const tools = getTools();
  const tool = tools.find((item) => item.kind === kind) ?? tools[0];
  const Icon = tool.icon;

  return (
    <div className="mx-auto max-w-3xl space-y-3 px-4">
      <div className="bg-foreground text-background ml-auto max-w-[80%] rounded-2xl rounded-br-md px-4 py-3 text-sm leading-6">
        {prompt}
      </div>
      <article className="bg-card border-foreground/10 max-w-xl overflow-hidden rounded-2xl border shadow-sm">
        {pending ? (
          <div className="flex items-center gap-3 px-4 py-4">
            <span className="bg-foreground text-background grid size-8 place-items-center rounded-lg">
              <Loader2 className="size-4 animate-spin" />
            </span>
            <div>
              <p className="text-sm font-medium">
                {m['file_studio.generating']()}
              </p>
              <p className="text-foreground/50 mt-0.5 text-xs">
                {m['file_studio.status.plan']()} ·{' '}
                {m['file_studio.status.write']()} ·{' '}
                {m['file_studio.status.render']()}
              </p>
            </div>
          </div>
        ) : artifact ? (
          <>
            <div className="border-foreground/10 flex items-center gap-3 border-b px-4 py-3.5">
              <span className="bg-foreground text-background grid size-8 place-items-center rounded-lg">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {artifact.fileName}
                </p>
                <p className="text-foreground/50 mt-0.5 text-xs">
                  {templateLabel(artifact.template ?? template)} ·{' '}
                  {artifact.mode === 'ai'
                    ? m['file_studio.ai_result']()
                    : m['file_studio.draft_result']()}
                </p>
              </div>
              <DownloadArtifact artifact={artifact} />
            </div>
            <ArtifactPreview artifact={artifact} />
          </>
        ) : null}
      </article>
    </div>
  );
}

function DownloadArtifact({ artifact }: { artifact: FileArtifact }) {
  function download() {
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

  return (
    <button
      type="button"
      onClick={download}
      className="hover:bg-foreground/5 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors"
    >
      <Download className="size-3.5" />
      {m['file_studio.download']()}
    </button>
  );
}

function ArtifactPreview({ artifact }: { artifact: FileArtifact }) {
  const { preview } = artifact;
  if (preview.kind === 'pptx') {
    const slide = preview.slides?.[0];
    return (
      <div className="bg-[#171b26] p-3 text-white">
        <div className="flex aspect-[16/8.6] flex-col justify-between rounded-md border border-white/10 px-4 py-3">
          <span className="text-[9px] font-semibold tracking-[0.22em] text-lime-300">
            PRESENTATION
          </span>
          <div>
            <p className="text-base font-semibold">
              {slide?.title ?? preview.title}
            </p>
            <p className="mt-1 line-clamp-2 text-xs text-white/60">
              {slide?.body?.[0] ?? preview.subtitle}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (preview.kind === 'docx') {
    const section = preview.sections?.[0];
    return (
      <div className="bg-muted/30 p-3">
        <div className="bg-background border-foreground/10 mx-auto min-h-28 max-w-72 border px-5 py-4 shadow-sm">
          <p className="text-foreground/45 text-[9px] font-semibold tracking-[0.18em] uppercase">
            Document
          </p>
          <p className="mt-2 text-sm font-semibold">{preview.title}</p>
          <p className="text-foreground/60 mt-2 line-clamp-2 text-xs leading-5">
            {section?.paragraphs?.[0] ?? preview.subtitle}
          </p>
        </div>
      </div>
    );
  }

  const columns = preview.columns?.slice(0, 4) ?? [];
  const rows = preview.rows?.slice(0, 3) ?? [];
  return (
    <div className="bg-muted/30 overflow-x-auto p-3">
      <table className="w-full min-w-[360px] border-collapse text-left text-[10px]">
        <thead className="bg-background text-foreground/60">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="border-foreground/10 border px-2 py-1.5 font-medium"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="bg-background/70">
              {columns.map((_, columnIndex) => (
                <td
                  key={columnIndex}
                  className="border-foreground/10 text-foreground/65 max-w-28 truncate border px-2 py-1.5"
                >
                  {row[columnIndex] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
