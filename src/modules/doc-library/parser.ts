/**
 * Document parsing for the Document Library feature.
 *
 * Supported formats (in priority order):
 *   - PDF: pdf-parse extracts per-page text separated by form-feed \f.
 *   - DOCX: mammoth pulls the main body XML and strips XML markup.
 *   - XLSX / XLS: xlsx reads each sheet as plain text rows.
 *   - PPTX: jszip + a small XML walk of slideN.xml files.
 *   - Plain text / Markdown: passthrough after a UTF-8 decode.
 *
 * All parsers return the same ParsedDocument shape so the service layer can
 * stash them into the doc_collection_document row without branching.
 *
 * Truncation: if the extracted text exceeds HARD_CHAR_LIMIT the body is sliced
 * to that limit and `truncated: true` is set; the service still inserts the
 * truncated text but flags it on parseStatus='truncated' so the UI can warn
 * the user.
 */

export const HARD_CHAR_LIMIT = 3_500_000; // ~875K tokens, headroom under 1M

export interface ParsedDocument {
  text: string;
  pageCount: number;
  truncated: boolean;
  meta?: {
    title?: string;
    author?: string;
    pageMap?: Array<{ page: number; charStart: number; charEnd: number }>;
  };
}

interface ParseArgs {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export async function parseDocument(args: ParseArgs): Promise<ParsedDocument> {
  const { buffer, mimeType, filename } = args;
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const type = mimeType || `application/${ext}`;

  if (type === 'application/pdf' || ext === 'pdf') return parsePdf(buffer);
  if (
    type ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  )
    return parseDocx(buffer);
  if (type === 'application/msword' || ext === 'doc') return parseDoc(buffer);
  if (
    type ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ext === 'xlsx'
  )
    return parseXlsx(buffer);
  if (type === 'application/vnd.ms-excel' || ext === 'xls')
    return parseXls(buffer);
  if (
    type ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ext === 'pptx'
  )
    return parsePptx(buffer);
  if (
    type === 'text/plain' ||
    ext === 'txt' ||
    ext === 'md' ||
    ext === 'markdown'
  )
    return parseText(buffer);
  if (type === 'text/csv' || ext === 'csv') return parseCsv(buffer);

  // Fallback: best-effort UTF-8 decode.
  return parseText(buffer);
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // Lazy import so the parser module loads even on cold paths without
  // pulling pdf-parse into the bundle when only text is uploaded.
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buffer);
  const raw = data.text || '';
  // pdf-parse joins pages with a literal form-feed char (\f). Treat each
  // page block as a single "page" for citation mapping.
  const parts = raw.split('\f');
  const pageMap: Array<{ page: number; charStart: number; charEnd: number }> =
    [];
  let cursor = 0;
  const rebuilt: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    rebuilt.push(part);
    cursor += part.length;
    pageMap.push({
      page: i + 1,
      charStart: cursor - part.length,
      charEnd: cursor,
    });
  }
  const merged = rebuilt.join('\n\n');
  return finalize(merged, {
    pageCount: data.numpages || pageMap.length,
    meta: {
      title: data.info?.Title || undefined,
      author: data.info?.Author || undefined,
      pageMap,
    },
  });
}

// ─── DOCX ────────────────────────────────────────────────────────────────────

async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return finalize(result.value || '', {});
}

async function parseDoc(buffer: Buffer): Promise<ParsedDocument> {
  // Old .doc binary format is hard to parse without antiword / catdoc.
  // We surface an explicit "needs conversion" error so the UI can tell the
  // user to re-save as .docx instead of silently returning empty text.
  throw new Error(
    'Legacy .doc files are not supported — please re-save as .docx or .pdf'
  );
}

// ─── XLSX / XLS ──────────────────────────────────────────────────────────────

async function parseXlsx(buffer: Buffer): Promise<ParsedDocument> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const blocks: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    blocks.push(`### Sheet: ${sheetName}\n\n${csv}`);
  }
  return finalize(blocks.join('\n\n'), { pageCount: wb.SheetNames.length });
}

async function parseXls(buffer: Buffer): Promise<ParsedDocument> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const blocks: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    blocks.push(`### Sheet: ${sheetName}\n\n${XLSX.utils.sheet_to_csv(sheet)}`);
  }
  return finalize(blocks.join('\n\n'), { pageCount: wb.SheetNames.length });
}

// ─── PPTX ────────────────────────────────────────────────────────────────────

async function parsePptx(buffer: Buffer): Promise<ParsedDocument> {
  // PPTX is a zip of XML files; we want slideN.xml in numeric order.
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return na - nb;
    });
  const blocks: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async('string');
    const text = xmlToPlainText(xml);
    const slideNum = name.match(/slide(\d+)\.xml/)?.[1] ?? '?';
    blocks.push(`### Slide ${slideNum}\n\n${text}`);
  }
  return finalize(blocks.join('\n\n'), { pageCount: slideNames.length });
}

function xmlToPlainText(xml: string): string {
  // Strip all XML tags (keep text content only). Good enough for slide
  // bodies; formatting like bold/italic is intentionally dropped.
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Plain text / CSV ─────────────────────────────────────────────────────────

async function parseText(buffer: Buffer): Promise<ParsedDocument> {
  return finalize(buffer.toString('utf-8').replace(/�/g, ''), {});
}

async function parseCsv(buffer: Buffer): Promise<ParsedDocument> {
  return finalize(buffer.toString('utf-8').replace(/�/g, ''), {});
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function finalize(
  text: string,
  opts: {
    pageCount?: number;
    meta?: ParsedDocument['meta'];
  }
): ParsedDocument {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    // Signal "looks like a scanned PDF" — the service layer maps this to
    // parseStatus='failed' with a specific user-facing error.
    throw new Error(
      'No extractable text was found. The file may be a scanned image — please use a PDF with selectable text.'
    );
  }
  if (trimmed.length > HARD_CHAR_LIMIT) {
    return {
      text: trimmed.slice(0, HARD_CHAR_LIMIT),
      pageCount: opts.pageCount ?? 0,
      truncated: true,
      meta: opts.meta,
    };
  }
  return {
    text: trimmed,
    pageCount: opts.pageCount ?? 0,
    truncated: false,
    meta: opts.meta,
  };
}
