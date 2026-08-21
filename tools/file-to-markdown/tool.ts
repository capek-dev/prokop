// MIT License — https://github.com/jojomondag/FileToMarkdown
// Adapted from jojomondag/FileToMarkdown (MIT) — converted per-converter logic ported to TypeScript + Jean2 wrapper
import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { NoneVisualization } from '@prokopai/sdk';
import { dirname, join } from 'path';


const MAX_FILE_SIZE = 50 * 1024 * 1024;
const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`;
const MAX_BYTES = 50 * 1024;

interface Input {
  path: string;
  offset?: number;
  limit?: number;
}

export const definition: ToolDefinition = {
  name: 'file-to-markdown',
  description:
    'Converts files to Markdown format. Supports PDF, Microsoft Office (.docx, .xlsx, .pptx), LibreOffice (.odt, .ods, .odp), and ZIP archives.\n\nWhen to use:\n- PDF documents (.pdf)\n- Microsoft Office (.docx, .xlsx, .pptx)\n- LibreOffice documents (.odt, .ods, .odp)\n- Archive files (.zip)\n\nWhen NOT to use:\n- Plain text or code files (.txt, .md, .js, .py, etc.) — use read-file instead\n- Fetching content from URLs — use webfetch instead\n\nParameters:\n- path (required): The absolute path to the file to convert to Markdown\n- offset (optional): The line number to start reading from (1-indexed). Use to continue reading large outputs.\n- limit (optional): Maximum number of lines to return (defaults to 2000)\n\nBest practices:\n- For large documents, output is paginated — use offset to read subsequent sections\n- Use read-file for plain text and code files — it\'s faster and doesn\'t require conversion\n- Maximum supported file size is 50MB',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The absolute path to the file to convert to Markdown',
      },
      offset: {
        type: 'number',
        description: 'The line number to start reading from (1-indexed)',
      },
      limit: {
        type: 'number',
        description: 'The maximum number of lines to read (defaults to 2000)',
      },
    },
    required: ['path'],
  },
  timeout: 60000,
};

export function computeChecksum(filePath: string, size: number, mtimeMs: number): string {
  return Bun.hash(`${filePath}:${size}:${mtimeMs}`).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

export type SupportedFormat = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp' | 'zip';

export function detectFormat(path: string): SupportedFormat | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.pptx')) return 'pptx';
  if (lower.endsWith('.odt')) return 'odt';
  if (lower.endsWith('.ods')) return 'ods';
  if (lower.endsWith('.odp')) return 'odp';
  if (lower.endsWith('.zip')) return 'zip';
  return null;
}

// ---------------------------------------------------------------------------
// PDF — pdfjs-dist (Apache 2.0: Mozilla)
// ---------------------------------------------------------------------------

export async function convertPdf(buffer: Uint8Array): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  // Resolve worker from the actual pdfjs-dist module location — works in dev (monorepo hoist) and production
  try {
    const mainUrl = import.meta.resolve('pdfjs-dist');
    const mainPath = new URL(mainUrl).pathname;
    pdfjsLib.GlobalWorkerOptions.workerSrc = join(dirname(mainPath), 'pdf.worker.mjs');
  } catch {
    // Bundled or unusual environment — fall back to relative path
    pdfjsLib.GlobalWorkerOptions.workerSrc = join(import.meta.dir, 'node_modules/pdfjs-dist/build/pdf.worker.mjs');
  }
  const doc = await pdfjsLib.getDocument({ data: buffer, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any) => item.str)
      .join('');
    pages.push(pageText);
  }
  return pages.join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// DOCX — mammoth (MIT: jojomondag/FileToMarkdown)
// ---------------------------------------------------------------------------

export async function convertDocx(buffer: Uint8Array): Promise<string> {
  // Adapted from https://github.com/jojomondag/FileToMarkdown — src/converters/docx.js
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mammoth = (await import('mammoth') as any).default ?? await import('mammoth');
  const styleMap = [...Array(6)].map((_, i) => `p[style-name='Heading ${i + 1}'] => h${i + 1}:fresh`);
  const { value } = await mammoth.convertToMarkdown({ buffer }, { styleMap });
  return value.trim();
}

// ---------------------------------------------------------------------------
// XLSX / ODS — xlsx (SheetJS CE, MIT: jojomondag/FileToMarkdown)
// ---------------------------------------------------------------------------

type XLSXModule = typeof import('xlsx');

export async function convertXlsx(buffer: Uint8Array): Promise<string> {
  // Adapted from https://github.com/jojomondag/FileToMarkdown — src/converters/xlsx.js
  // xlsx (SheetJS CE) ships proper ESM — works cleanly in Bun
  const mod = await import('xlsx');
  const XLSX = mod as XLSXModule;
  const workbook = XLSX.read(buffer, { type: 'array' });
  return sheetToMarkdown(workbook, XLSX);
}

export async function convertOds(buffer: Uint8Array): Promise<string> {
  // Adapted from https://github.com/jojomondag/FileToMarkdown — src/converters/ods.js
  const mod = await import('xlsx');
  const XLSX = mod as XLSXModule;
  const workbook = XLSX.read(buffer, { type: 'array' });
  return sheetToMarkdown(workbook, XLSX);
}

export function sheetToMarkdown(
  workbook: { SheetNames: string[]; Sheets: Record<string, unknown> },
  XLSX: XLSXModule,
): string {
  const isEmpty = (v: unknown) => v == null || (typeof v === 'string' && !v.trim());
  return workbook.SheetNames.map((s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (XLSX.utils as any).sheet_to_json(workbook.Sheets[s], { header: 1, defval: '' }) as unknown[][];
    if (!data.length) return `# ${s}\n\n---\n\n`;

    // Trim trailing all-empty rows
    let r = data.length - 1;
    while (r >= 0 && data[r].every((c) => isEmpty(c))) r--;
    const trimmed = data.slice(0, r + 1);
    if (!trimmed.length) return `# ${s}\n\n---\n\n`;

    // Find last column with any content
    let c = -1;
    for (const row of trimmed) {
      let i = row.length - 1;
      while (i >= 0 && isEmpty(row[i])) i--;
      if (i > c) c = i;
    }
    if (c < 0) return `# ${s}\n\n---\n\n`;

    const rows = trimmed.map((row) => row.slice(0, c + 1));
    return [
      `# ${s}\n`,
      `| ${Array(c + 1).fill('').join(' | ')} |`,
      `| ${Array(c + 1).fill('---').join(' | ')} |`,
      ...rows.map((row) =>
        `| ${[...row, ...Array(c + 1 - row.length).fill('')].slice(0, c + 1).map((v) => (v ?? '') as string).join(' | ')} |`,
      ),
      '\n---\n',
    ].join('\n');
  }).join('\n').trim();
}

// ---------------------------------------------------------------------------
// PPTX — adm-zip + xml2js (MIT: jojomondag/FileToMarkdown)
// ---------------------------------------------------------------------------

export async function convertPptx(buffer: Uint8Array): Promise<string> {
  // Adapted from https://github.com/jojomondag/FileToMarkdown — src/converters/pptx.js
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AdmZip = ((await import('adm-zip')).default ?? (await import('adm-zip'))) as any;
  const { Parser } = await import('xml2js');
  const zip = new AdmZip(buffer as Buffer);
  const parser = new Parser();

  const entries = zip.getEntries()
    .filter((e: { entryName: string }) => e.entryName.startsWith('ppt/slides/slide'))
    .sort((a: { entryName: string }, b: { entryName: string }) => {
      const na = parseInt(a.entryName.match(/slide(\d+)/)?.[1] ?? '0', 10);
      const nb = parseInt(b.entryName.match(/slide(\d+)/)?.[1] ?? '0', 10);
      return na - nb;
    });

  const slides = await Promise.all(
    entries.map(async (e: { entryName: string }, i: number) => {
      const raw = zip.readAsText(e.entryName);
      if (!raw) return '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = (await parser.parseStringPromise(raw)) as any;
      const texts: string[] = [];
      const traverse = (o: unknown) => {
        if (!o) return;
        if (Array.isArray(o)) { o.forEach(traverse); }
        else if (typeof o === 'object') {
          if ((o as Record<string, unknown>)['a:t']) {
            const val = (o as Record<string, unknown>)['a:t'];
            // a:t may be an array of text runs (upstream behavior) — join them
            if (Array.isArray(val)) {
              texts.push((val as string[]).join(''));
            } else {
              texts.push(val as string);
            }
          }
          Object.values(o as Record<string, unknown>).forEach(traverse);
        }
      };
      try {
        traverse(parsed?.['p:sld']?.['p:cSld']?.[0]?.['p:spTree']);
      } catch { /* ignore traversal errors */ }
      return `# Slide ${i + 1}\n\n${texts.join('\n')}\n\n---\n\n`;
    }),
  );

  return slides.join('').trim();
}

// ---------------------------------------------------------------------------
// ODT — adm-zip + xml2js (MIT: jojomondag/FileToMarkdown)
// ---------------------------------------------------------------------------

export async function convertOdt(buffer: Uint8Array): Promise<string> {
  // Adapted from https://github.com/jojomondag/FileToMarkdown — src/converters/odt.js
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AdmZip = ((await import('adm-zip')).default ?? (await import('adm-zip'))) as any;
  const { Parser } = await import('xml2js');
  const zip = new AdmZip(buffer as Buffer);
  const parser = new Parser();

  const contentEntry = zip.getEntry('content.xml');
  if (!contentEntry) return '# Document\n\nNo content found.\n\n';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (await parser.parseStringPromise(zip.readAsText(contentEntry.entryName))) as any;

  const extractTextContent = (obj: unknown): string => {
    const texts: string[] = [];
    const traverse = (o: unknown) => {
      if (!o) return;
      if (typeof o === 'string') { texts.push(o); }
      else if (Array.isArray(o)) { o.forEach(traverse); }
      else if (typeof o === 'object') {
        const obj2 = o as Record<string, unknown>;
        if (obj2._ && typeof obj2._ === 'string') texts.push(obj2._);
        if (obj2['text:span']) {
          const span = obj2['text:span'];
          if (Array.isArray(span)) {
            span.forEach((s) => {
              if (typeof s === 'string') texts.push(s);
              else if ((s as Record<string, unknown>)._) texts.push((s as Record<string, unknown>)._ as string);
              else traverse(s);
            });
          } else if (typeof span === 'string') {
            texts.push(span);
          } else if ((span as Record<string, unknown>)._) {
            texts.push((span as Record<string, unknown>)._ as string);
          } else {
            traverse(span);
          }
        }
        if (obj2['text:s']) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cnt = parseInt((obj2['text:s'] as any)?.$?.['text:c'] as string ?? '1', 10);
          texts.push(' '.repeat(cnt));
        }
        if (obj2['text:tab']) texts.push('\t');
        if (obj2['text:line-break']) texts.push('\n');
        Object.values(obj2).forEach(traverse);
      }
    };
    traverse(obj);
    return texts.join('').replace(/(.+)\1+/g, '$1').trim();
  };

  const convertTableToMarkdown = (table: unknown): string => {
    const obj = table as Record<string, unknown>;
    if (!obj['table:table-row']) return '';
    const rows = Array.isArray(obj['table:table-row']) ? obj['table:table-row'] : [obj['table:table-row']];
    const markdownRows: string[] = [];
    rows.forEach((row, rowIndex) => {
      const r2 = row as Record<string, unknown>;
      if (r2['table:table-cell']) {
        const cells = Array.isArray(r2['table:table-cell']) ? r2['table:table-cell'] : [r2['table:table-cell']];
        const cellTexts = (cells as Record<string, unknown>[]).map((cell) => extractTextContent(cell) || '');
        markdownRows.push(`| ${cellTexts.join(' | ')} |`);
        if (rowIndex === 0) {
          markdownRows.push(`| ${cellTexts.map(() => '---').join(' | ')} |`);
        }
      }
    });
    return markdownRows.join('\n');
  };

  const extractTextFromParagraphs = (obj: unknown): string => {
    const texts: string[] = [];
    const traverse = (o: unknown) => {
      if (!o) return;
      if (Array.isArray(o)) { o.forEach(traverse); }
      else if (typeof o === 'object') {
        const obj2 = o as Record<string, unknown>;
        if (obj2['text:h']) {
          const headings = Array.isArray(obj2['text:h']) ? obj2['text:h'] : [obj2['text:h']];
          (headings as Record<string, unknown>[]).forEach((h) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const level = parseInt((h as any)?.$?.['text:outline-level'] as string ?? '1', 10);
            const headingText = extractTextContent(h).replace(/P\d+/g, '').trim();
            if (headingText) texts.push(`${'#'.repeat(Math.min(level, 6))} ${headingText}\n\n`);
          });
        }
        if (obj2['text:p']) {
          const paragraphs = Array.isArray(obj2['text:p']) ? obj2['text:p'] : [obj2['text:p']];
          (paragraphs as Record<string, unknown>[]).forEach((p) => {
            const paragraphText = extractTextContent(p).replace(/P\d+/g, '').trim();
            if (paragraphText) texts.push(`${paragraphText}\n\n`);
          });
        }
        if (obj2['text:list']) {
          const lists = Array.isArray(obj2['text:list']) ? obj2['text:list'] : [obj2['text:list']];
          lists.forEach((list) => {
            const list2 = list as Record<string, unknown>;
            if (list2['text:list-item']) {
              const items = Array.isArray(list2['text:list-item']) ? list2['text:list-item'] : [list2['text:list-item']];
              (items as Record<string, unknown>[]).forEach((item) => {
                const itemText = extractTextContent(item);
                if (itemText.trim()) texts.push(`- ${itemText}\n`);
              });
              texts.push('\n');
            }
          });
        }
        if (obj2['table:table']) {
          const tables = Array.isArray(obj2['table:table']) ? obj2['table:table'] : [obj2['table:table']];
          tables.forEach((table) => {
            const tableMarkdown = convertTableToMarkdown(table);
            if (tableMarkdown) texts.push(`${tableMarkdown}\n\n`);
          });
        }
        Object.values(obj2).forEach(traverse);
      }
    };
    traverse(obj);
    return texts.join('');
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (content as any)?.['office:document-content']?.['office:body']?.[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textContent = (body as any)?.['office:text']?.[0];
    return extractTextFromParagraphs(textContent).trim() || '# Document\n\nNo readable content found.\n\n';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `# Document\n\nError reading document: ${msg}\n\n`;
  }
}

// ---------------------------------------------------------------------------
// ODP — adm-zip + xml2js (MIT: jojomondag/FileToMarkdown)
// ---------------------------------------------------------------------------

export async function convertOdp(buffer: Uint8Array): Promise<string> {
  // Adapted from https://github.com/jojomondag/FileToMarkdown — src/converters/odp.js
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AdmZip = ((await import('adm-zip')).default ?? (await import('adm-zip'))) as any;
  const { Parser } = await import('xml2js');
  const zip = new AdmZip(buffer as Buffer);
  const parser = new Parser();

  const contentEntry = zip.getEntry('content.xml');
  if (!contentEntry) return '# Presentation\n\nNo content found.\n\n---\n\n';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (await parser.parseStringPromise(zip.readAsText(contentEntry.entryName))) as any;

  const extractText = (obj: unknown): string[] => {
    const texts: string[] = [];
    const traverse = (o: unknown) => {
      if (!o) return;
      if (Array.isArray(o)) { o.forEach(traverse); }
      else if (typeof o === 'object') {
        const obj2 = o as Record<string, unknown>;
        if (typeof o === 'string') { texts.push(o); return; }
        if (obj2['text:p']) {
          const p = obj2['text:p'];
          if (Array.isArray(p)) {
            p.forEach((pp) => {
              if (typeof pp === 'string') texts.push(pp);
              else if ((pp as Record<string, unknown>)._) texts.push((pp as Record<string, unknown>)._ as string);
              else if ((pp as Record<string, unknown>)['text:span']) {
                const span = (pp as Record<string, unknown>)['text:span'];
                if (Array.isArray(span)) span.forEach((s) => {
                  if (typeof s === 'string') texts.push(s);
                  else if ((s as Record<string, unknown>)._) texts.push((s as Record<string, unknown>)._ as string);
                });
                else if ((span as Record<string, unknown>)._) texts.push((span as Record<string, unknown>)._ as string);
              }
            });
          } else if (typeof p === 'string') {
            texts.push(p);
          } else if ((p as Record<string, unknown>)._) {
            texts.push((p as Record<string, unknown>)._ as string);
          }
        }
        if (obj2['text:span']) {
          const span = obj2['text:span'];
          if (Array.isArray(span)) span.forEach((s) => {
            if (typeof s === 'string') texts.push(s);
            else if ((s as Record<string, unknown>)._) texts.push((s as Record<string, unknown>)._ as string);
          });
          else if (typeof span === 'string') texts.push(span);
          else if ((span as Record<string, unknown>)._) texts.push((span as Record<string, unknown>)._ as string);
        }
        if (obj2._ && typeof obj2._ === 'string') texts.push(obj2._);
        Object.values(obj2).forEach(traverse);
      } else if (typeof o === 'string') {
        texts.push(o);
      }
    };
    traverse(obj);
    return texts.filter((t) => t && t.trim().length > 0);
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const presentation = (content as any)?.['office:document-content']?.['office:body']?.[0]?.['office:presentation'];
    const slides: string[] = [];
    if (presentation && presentation[0] && (presentation[0] as Record<string, unknown>)['draw:page']) {
      const pages = Array.isArray((presentation[0] as Record<string, unknown>)['draw:page'])
        ? (presentation[0] as Record<string, unknown>)['draw:page']
        : [(presentation[0] as Record<string, unknown>)['draw:page']];
      (pages as Record<string, unknown>[]).forEach((page, index) => {
        const texts = extractText(page);
        const slideContent = texts.length > 0 ? texts.join('\n') : 'No text content found.';
        slides.push(`# Slide ${index + 1}\n\n${slideContent}\n\n---\n\n`);
      });
    }
    return slides.length > 0 ? slides.join('').trim() : '# Presentation\n\nNo slides found.\n\n---\n\n';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `# Presentation\n\nError reading presentation: ${msg}\n\n---\n\n`;
  }
}

// ---------------------------------------------------------------------------
// ZIP — adm-zip (MIT: jojomondag/FileToMarkdown)
// ---------------------------------------------------------------------------

export async function convertZip(buffer: Uint8Array): Promise<string> {
  // Adapted from https://github.com/jojomondag/FileToMarkdown — src/converters/zip.js
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AdmZip = ((await import('adm-zip')).default ?? (await import('adm-zip'))) as any;
  const zip = new AdmZip(buffer as Buffer);

  const entries = zip.getEntries().sort((a: { entryName: string }, b: { entryName: string }) =>
    a.entryName.localeCompare(b.entryName),
  );

  const lines: string[] = [];
  for (const entry of entries) {
    const { entryName } = entry;
    if (entry.isDirectory) {
      lines.push(`### ${entryName}/`);
      lines.push('');
    } else {
      lines.push(`### ${entryName}`);
      lines.push('');
      const ext = entryName.toLowerCase().replace(/^.*\./, '');
      if (['txt', 'md', 'js', 'json', 'csv', 'xml', 'html', 'css', 'yaml', 'yml', 'ini', 'conf'].includes(ext)) {
        const content = zip.readAsText(entryName);
        if (content) {
          lines.push('```' + ext);
          lines.push(content);
          lines.push('```');
        } else {
          lines.push('*Error reading file*');
        }
      } else {
        lines.push('*Binary file*');
      }
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function convertToMarkdown(filePath: string, buffer: Uint8Array): Promise<string> {
  const format = detectFormat(filePath);
  if (!format) {
    throw new Error(
      `Unsupported file format. Supported: .pdf, .docx, .xlsx, .pptx, .odt, .ods, .odp, .zip`,
    );
  }

  switch (format) {
    case 'pdf':
      return convertPdf(buffer);
    case 'docx':
      return convertDocx(buffer);
    case 'xlsx':
      return convertXlsx(buffer);
    case 'pptx':
      return convertPptx(buffer);
    case 'odt':
      return convertOdt(buffer);
    case 'ods':
      return convertOds(buffer);
    case 'odp':
      return convertOdp(buffer);
    case 'zip':
      return convertZip(buffer);
  }
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    const resolvedPath = ctx.resolvePath(input.path);

    if (ctx.isBlockedPath(resolvedPath)) {
      return { success: false, error: `Reading from system directories is not allowed: ${input.path}` };
    }

    const tempDir = ctx.env.get('JEAN2_TEMP_DIR') || ctx.env.get('TMPDIR') || '';
    const jean2TempPrefix = tempDir ? `${tempDir.replace(/[/\\]$/, '')}/jean2/` : '';
    const isJean2Temp = jean2TempPrefix && resolvedPath.startsWith(jean2TempPrefix);

    const isAllowedPath = ctx.allowedPaths && ctx.allowedPaths.some((p) => resolvedPath.startsWith(p));

    if (!isJean2Temp && !isAllowedPath && !ctx.isWithinWorkspace(resolvedPath)) {
      const approved = await ctx.ask({
        target: 'permission',
        type: 'permission',
        question: 'Reading from files outside the workspace requires approval.',
        risk: 'medium',
        metadata: { permissionKey: 'path:outside_workspace', permissionType: 'action' },
      });
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    if (ctx.isSensitivePath(resolvedPath)) {
      const approved = await ctx.ask({
        target: 'permission',
        type: 'permission',
        question: 'Reading from sensitive files requires approval.',
        risk: 'medium',
        metadata: { permissionKey: 'file_pattern:sensitive', permissionType: 'action' },
      });
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    const stat = await ctx.fs.stat(resolvedPath);

    if (!stat) {
      return { success: false, error: `File not found: ${resolvedPath}` };
    }

    if (stat.isDirectory) {
      return { success: false, error: `Path is a directory, not a file: ${resolvedPath}` };
    }

    if (stat.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `File too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB (max 50MB)`,
      };
    }

    const checksum = computeChecksum(resolvedPath, stat.size, stat.modifiedAt.getTime());
    const cacheDir = `${ctx.fs.tempDir}/${ctx.sessionId}`;
    const cachePath = `${cacheDir}/file-to-markdown-${checksum}.md`;

    let markdown: string;
    let fromCache = false;

    if (await ctx.fs.exists(cachePath)) {
      markdown = await ctx.fs.readFile(cachePath, 'utf-8');
      fromCache = true;
    } else {
      const fileBuffer = await ctx.fs.readFile(resolvedPath);
      markdown = await convertToMarkdown(resolvedPath, fileBuffer);
      try {
        const dirExists = await ctx.fs.exists(cacheDir);
        if (!dirExists) {
          await ctx.fs.mkdir(cacheDir, { recursive: true });
        }
        await ctx.fs.writeFile(cachePath, markdown);
      } catch {
        // cache write failed, still return result
      }
    }

    const lines = markdown.split('\n');

    const readLimit = input.limit ?? DEFAULT_READ_LIMIT;
    const readOffset = input.offset ?? 1;
    const start = readOffset - 1;

    if (readOffset < 1) {
      return { success: false, error: 'offset must be greater than or equal to 1' };
    }

    const outputLines: string[] = [];
    let bytes = 0;

    for (let i = start; i < lines.length && outputLines.length < readLimit; i++) {
      let line = lines[i];

      if (line.length > MAX_LINE_LENGTH) {
        line = line.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX;
      }

      const lineWithNumber = `${i + 1}: ${line}`;
      const lineSize = new TextEncoder().encode(lineWithNumber).length + (outputLines.length > 0 ? 1 : 0);

      if (bytes + lineSize > MAX_BYTES) {
        break;
      }

      outputLines.push(lineWithNumber);
      bytes += lineSize;
    }

    const content = outputLines.join('\n');
    const totalLines = lines.length;
    const lastReadLine = start + outputLines.length;
    const nextOffset = lastReadLine + 1;
    const truncated = lastReadLine < totalLines;

    let finalContent = content;
    if (truncated) {
      finalContent += `\n\n(Showing lines ${readOffset}-${lastReadLine} of ${totalLines}. Use offset=${nextOffset} to continue.)`;
    } else {
      finalContent += `\n\n(End of converted markdown - total ${totalLines} lines)`;
    }

    const cacheInfo = fromCache ? ' (from cache)' : '';

    const visualization: NoneVisualization = {
      type: 'none',
      message: `Converted to markdown: ${resolvedPath}${cacheInfo}`,
    };

    return {
      success: true,
      result: { content: finalContent, cachePath },
      visualization,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
