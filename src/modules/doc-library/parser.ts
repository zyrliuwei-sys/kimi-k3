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

// ─── DOMMatrix polyfill ──────────────────────────────────────────────────────
// pdf-parse v2 bundles pdfjs-dist v5, whose legacy build does:
//   if (!globalThis.DOMMatrix) {
//     if (canvas?.DOMMatrix) globalThis.DOMMatrix = canvas.DOMMatrix;
//     else warn("Cannot polyfill `DOMMatrix`, rendering may be broken.");
//   }
//   ...
//   const domMatrix = new DOMMatrix(inverse); // <-- explodes on Cloudflare Workers
//
// Workers has no browser globals and no `canvas` native module, so `globalThis.DOMMatrix`
// stays undefined and the `new DOMMatrix(...)` calls inside pdfjs throw.
// We install a minimal affine-transform matrix class before pdf-parse loads.
// It implements the surface area pdfjs-dist actually calls during text
// extraction (`new DOMMatrix(arr)`, `.multiplySelf`, `.translateSelf`,
// `.scaleSelf`, `.rotateSelf`, `.inverseSelf`, `.toFloat32Array`). Anything
// outside that surface is for renderer-only paths we never hit.
class DOMMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  constructor(init?: ArrayLike<number> | DOMMatrixPolyfill) {
    if (init instanceof DOMMatrixPolyfill) {
      this.a = init.a;
      this.b = init.b;
      this.c = init.c;
      this.d = init.d;
      this.e = init.e;
      this.f = init.f;
    } else if (init && init.length === 6) {
      this.a = init[0];
      this.b = init[1];
      this.c = init[2];
      this.d = init[3];
      this.e = init[4];
      this.f = init[5];
    }
  }
  multiplySelf(o: DOMMatrixPolyfill): this {
    const a = this.a,
      b = this.b,
      c = this.c,
      d = this.d,
      e = this.e,
      f = this.f;
    this.a = a * o.a + c * o.b;
    this.b = b * o.a + d * o.b;
    this.c = a * o.c + c * o.d;
    this.d = b * o.c + d * o.d;
    this.e = a * o.e + c * o.f + e;
    this.f = b * o.e + d * o.f + f;
    return this;
  }
  multiply(o: DOMMatrixPolyfill): DOMMatrixPolyfill {
    return new DOMMatrixPolyfill(this).multiplySelf(o);
  }
  translateSelf(tx: number, ty: number): this {
    this.e += this.a * tx + this.c * ty;
    this.f += this.b * tx + this.d * ty;
    return this;
  }
  scaleSelf(sx: number, sy: number = sx): this {
    this.a *= sx;
    this.b *= sx;
    this.c *= sy;
    this.d *= sy;
    return this;
  }
  rotateSelf(angle: number): this {
    const r = (angle * Math.PI) / 180;
    return this.multiplySelf(
      new DOMMatrixPolyfill([
        Math.cos(r),
        Math.sin(r),
        -Math.sin(r),
        Math.cos(r),
        0,
        0,
      ])
    );
  }
  inverseSelf(): this {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) throw new Error('Matrix is not invertible');
    const inv = 1 / det;
    const a = this.a,
      b = this.b,
      c = this.c,
      d = this.d,
      e = this.e,
      f = this.f;
    this.a = d * inv;
    this.b = -b * inv;
    this.c = -c * inv;
    this.d = a * inv;
    this.e = (c * f - d * e) * inv;
    this.f = -(a * f - b * e) * inv;
    return this;
  }
  toFloat32Array(): Float32Array {
    return new Float32Array([this.a, this.b, this.c, this.d, this.e, this.f]);
  }
  toJSON() {
    return { a: this.a, b: this.b, c: this.c, d: this.d, e: this.e, f: this.f };
  }
}

if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === 'undefined') {
  (globalThis as { DOMMatrix?: unknown }).DOMMatrix = DOMMatrixPolyfill;
}

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
  if (type === 'application/vnd.ms-powerpoint' || ext === 'ppt')
    return parsePpt(buffer);
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
  // pdf-parse v2.x ships an entirely different API from v1: a `PDFParse`
  // class you `new` with `{ data }`, then call `.getText()` on, then
  // `.destroy()` to free the worker. The old `(await import('pdf-parse'))
  // .default(buffer)` signature throws at runtime ("pdfParse is not a
  // function" or similar), which was the source of every PDF parse failure
  // in the playground chat.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  let text = '';
  let pageCount = 0;
  let meta: { title?: string; author?: string } = {};
  try {
    const result = await parser.getText();
    text = result?.text || '';
    pageCount = result?.total || result?.pages?.length || 0;

    // Best-effort metadata — swallow failures so a missing info block
    // doesn't tank the parse.
    try {
      const info = await parser.getInfo();
      meta = {
        title: info?.info?.Title || undefined,
        author: info?.info?.Author || undefined,
      };
    } catch {
      /* ignore */
    }

    // Build a per-page char map by walking the page array — gives the
    // doc-library citations a stable `page → char range` lookup.
    const pageMap: Array<{
      page: number;
      charStart: number;
      charEnd: number;
    }> = [];
    let cursor = 0;
    for (const p of result?.pages || []) {
      const pageText = p?.text || '';
      pageMap.push({
        page: p?.num ?? pageMap.length + 1,
        charStart: cursor,
        charEnd: cursor + pageText.length,
      });
      cursor += pageText.length;
    }
    meta = { ...meta, pageMap };
  } finally {
    await parser.destroy();
  }

  return finalize(text, {
    pageCount,
    meta,
  });
}

// ─── DOCX ────────────────────────────────────────────────────────────────────

async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const mammoth = await import('mammoth');
  // convertToMarkdown preserves headings, lists, and tables — extractRawText
  // flattens everything to whitespace-separated strings, which makes the
  // model guess at structure (and lose table content). The downstream LLM
  // understands markdown tables natively, so the upgrade is free.
  const result = await mammoth.convertToMarkdown({ buffer });
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

async function parsePpt(buffer: Buffer): Promise<ParsedDocument> {
  // Same story as .doc — legacy .ppt is OLE Compound File, needs a dedicated
  // reader (e.g. `node-pptx-parser`) that's flaky on modern files. Better to
  // ask the user to re-save as .pptx than silently swallow the file.
  throw new Error(
    'Legacy .ppt files are not supported — please re-save as .pptx or .pdf'
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
    blocks.push(renderSheetAsMarkdown(sheet, sheetName, XLSX));
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
    blocks.push(renderSheetAsMarkdown(sheet, sheetName, XLSX));
  }
  return finalize(blocks.join('\n\n'), { pageCount: wb.SheetNames.length });
}

// Render one sheet as a markdown table, preserving formulas + cell-format hints.
//
// Why not plain `sheet_to_csv`: it drops formulas entirely (only the computed
// value ships), and number/date formats show as raw serial numbers — the model
// has no way to tell that 45292 is "2024-01-15" or that 0.13 is a 13% tax
// rate. We walk the cells by address so we can surface `cell.f` and `cell.z`.
//
// We keep the columns tight (Address | Value | Format) so the AI can both
// quote the value and reason about the formula/format when relevant.
function renderSheetAsMarkdown(
  sheet: any,
  sheetName: string,
  XLSX: any
): string {
  const ref: string | undefined = sheet['!ref'];
  const range: any = ref ? XLSX.utils.decode_range(ref) : null;
  const lines: string[] = [`### Sheet: ${sheetName}`];

  if (!range) {
    lines.push('(empty sheet)');
    return lines.join('\n\n');
  }

  const rows: Array<{
    addr: string;
    value: string;
    formula: string;
    format: string;
  }> = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell) continue;
      // Skip cells that are completely empty in every dimension.
      const v = cell.v;
      const f = cell.f;
      const z: string | undefined = cell.z;
      if (v === undefined && v === null && !f) continue;

      let displayValue: string;
      if (cell.t === 'n' || cell.t === 'd') {
        // Format-stripped preview via `format` (raw: false), so the model
        // sees what the user sees (e.g. "2024-01-15" instead of 45292).
        try {
          displayValue = XLSX.SSF.format(z || 'General', v);
        } catch {
          displayValue = String(v);
        }
      } else if (cell.t === 'b') {
        displayValue = v ? 'TRUE' : 'FALSE';
      } else {
        displayValue = String(v ?? '');
      }

      rows.push({
        addr,
        value: displayValue,
        formula: f ? String(f) : '',
        format: z || '',
      });
    }
  }

  if (rows.length === 0) {
    lines.push('(empty sheet)');
    return lines.join('\n\n');
  }

  lines.push(
    '| Cell | Value | Format | Formula |',
    '| --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${row.addr} | ${row.value.replace(/\|/g, '\\|')} | ${row.format || '—'} | ${row.formula || '—'} |`
    )
  );

  return lines.join('\n');
}

// ─── PPTX ────────────────────────────────────────────────────────────────────

async function parsePptx(buffer: Buffer): Promise<ParsedDocument> {
  // PPTX is a zip of XML files; we want slideN.xml in numeric order, plus
  // the matching notesSlideN.xml for speaker notes.
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
    const section: string[] = [`### Slide ${slideNum}`, '', text];

    // Speaker notes — powerpoint stores these in ppt/notesSlides/notesSlideN.xml
    // alongside each slide. Including them lets the model answer "what was
    // the speaker actually trying to say" without us having to OCR audio.
    const notesName = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    const notesEntry = zip.files[notesName];
    if (notesEntry) {
      try {
        const notesXml = await notesEntry.async('string');
        const notesText = xmlToPlainText(notesXml);
        if (notesText) {
          section.push('', `**Speaker notes:** ${notesText}`);
        }
      } catch {
        /* notes are best-effort; a missing/malformed file shouldn't tank the parse */
      }
    }

    blocks.push(section.join('\n'));
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
