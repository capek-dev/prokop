import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import {
  definition,
  execute,
  detectFormat,
  computeChecksum,
  sheetToMarkdown,
  convertPdf,
  convertDocx,
  convertXlsx,
  convertOds,
  convertPptx,
  convertOdt,
  convertOdp,
  convertZip,
} from './tool';
import { createMockContext, VirtualFS, WORKSPACE } from '../test-utils';
import type { SupportedFormat } from './tool';

let vfs: VirtualFS;
let ctx: ReturnType<typeof createMockContext>;

beforeEach(() => {
  vfs = new VirtualFS();
  ctx = createMockContext(vfs);
});

afterEach(() => {
  mock.restore();
});

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('file-to-markdown tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('file-to-markdown');
  });

  test('has required path input', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toContain('path');
  });

  test('has optional offset and limit inputs', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties.offset).toBeDefined();
    expect(schema.properties.limit).toBeDefined();
  });

  test('has 60s timeout', () => {
    expect(definition.timeout).toBe(60000);
  });
});

// ══════════════════════════════════════════════════════════════════
// detectFormat
// ══════════════════════════════════════════════════════════════════

describe('detectFormat', () => {
  const cases: [string, SupportedFormat | null][] = [
    ['document.pdf', 'pdf'],
    ['report.PDF', 'pdf'],
    ['/path/to/file.docx', 'docx'],
    ['spreadsheet.xlsx', 'xlsx'],
    ['presentation.pptx', 'pptx'],
    ['writer.odt', 'odt'],
    ['calc.ods', 'ods'],
    ['impress.odp', 'odp'],
    ['archive.zip', 'zip'],
    ['ARCHIVE.ZIP', 'zip'],
    ['file.txt', null],
    ['file.md', null],
    ['file.js', null],
    ['file.png', null],
    ['file.doc', null],
    ['file.xls', null],
    ['file.ppt', null],
    ['noextension', null],
    ['.hidden.pdf', 'pdf'],
  ];

  for (const [path, expected] of cases) {
    test(`detects ${expected ?? 'null'} for "${path}"`, () => {
      expect(detectFormat(path)).toBe(expected);
    });
  }
});

// ══════════════════════════════════════════════════════════════════
// computeChecksum
// ══════════════════════════════════════════════════════════════════

describe('computeChecksum', () => {
  test('returns deterministic hex string', () => {
    const a = computeChecksum('/foo.pdf', 1024, 1700000000000);
    const b = computeChecksum('/foo.pdf', 1024, 1700000000000);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]+$/);
  });

  test('differs when inputs differ', () => {
    const a = computeChecksum('/foo.pdf', 1024, 1700000000000);
    const b = computeChecksum('/foo.pdf', 2048, 1700000000000);
    const c = computeChecksum('/bar.pdf', 1024, 1700000000000);
    const d = computeChecksum('/foo.pdf', 1024, 1700000000001);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });

  test('is 8 hex chars padded', () => {
    const result = computeChecksum('/test.pdf', 100, 1000);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });
});

// ══════════════════════════════════════════════════════════════════
// sheetToMarkdown
// ══════════════════════════════════════════════════════════════════

describe('sheetToMarkdown', () => {
  // Minimal XLSX-like module mock
  const mockXLSX = {
    utils: {
      sheet_to_json: (sheet: unknown) => sheet,
    },
  } as unknown as typeof import('xlsx');

  test('empty workbook produces empty string', () => {
    const workbook = { SheetNames: [], Sheets: {} };
    expect(sheetToMarkdown(workbook, mockXLSX)).toBe('');
  });

  test('single sheet with header and data rows produces markdown table', () => {
    const workbook = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: [
          ['Name', 'Age', 'City'],
          ['Alice', '30', 'NYC'],
          ['Bob', '25', 'LA'],
        ],
      },
    };
    const xlsx = {
      utils: {
        sheet_to_json: (sheet: unknown) => sheet,
      },
    } as unknown as typeof import('xlsx');

    const result = sheetToMarkdown(workbook, xlsx);
    expect(result).toContain('# Sheet1');
    expect(result).toContain('| Name | Age | City |');
    expect(result).toContain('| --- | --- | --- |');
    expect(result).toContain('| Alice | 30 | NYC |');
    expect(result).toContain('| Bob | 25 | LA |');
  });

  test('multiple sheets are joined with sheet headers', () => {
    const workbook = {
      SheetNames: ['Data', 'Summary'],
      Sheets: {
        Data: [['A', 'B'], ['1', '2']],
        Summary: [['X', 'Y'], ['10', '20']],
      },
    };
    const xlsx = {
      utils: {
        sheet_to_json: (sheet: unknown) => sheet,
      },
    } as unknown as typeof import('xlsx');

    const result = sheetToMarkdown(workbook, xlsx);
    expect(result).toContain('# Data');
    expect(result).toContain('# Summary');
    expect(result).toContain('| A | B |');
    expect(result).toContain('| X | Y |');
  });

  test('sheet with all empty rows is trimmed', () => {
    const workbook = {
      SheetNames: ['Empty'],
      Sheets: {
        Empty: [['Name'], [''], [''], ['']],
      },
    };
    const xlsx = {
      utils: {
        sheet_to_json: (sheet: unknown) => sheet,
      },
    } as unknown as typeof import('xlsx');

    const result = sheetToMarkdown(workbook, xlsx);
    expect(result).toContain('# Empty');
    expect(result).toContain('| Name |');
  });

  test('sheet with completely empty data shows header-only separator', () => {
    const workbook = {
      SheetNames: ['Nothing'],
      Sheets: {
        Nothing: [],
      },
    };
    const xlsx = {
      utils: {
        sheet_to_json: (sheet: unknown) => sheet,
      },
    } as unknown as typeof import('xlsx');

    const result = sheetToMarkdown(workbook, xlsx);
    expect(result).toContain('# Nothing');
  });

  test('rows with fewer columns are padded', () => {
    const workbook = {
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: [
          ['A', 'B', 'C'],
          ['1'],
          ['2', '3'],
        ],
      },
    };
    const xlsx = {
      utils: {
        sheet_to_json: (sheet: unknown) => sheet,
      },
    } as unknown as typeof import('xlsx');

    const result = sheetToMarkdown(workbook, xlsx);
    expect(result).toContain('| A | B | C |');
    expect(result).toContain('| 1 |  |  |');
    expect(result).toContain('| 2 | 3 |  |');
  });
});

// ══════════════════════════════════════════════════════════════════
// convertPdf (mocked pdfjs-dist)
// ══════════════════════════════════════════════════════════════════

describe('convertPdf', () => {
  test('extracts text from PDF buffer using pdfjs-dist', async () => {
    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({
              items: [{ str: '  Hello PDF World  ' }],
            }),
          }),
        }),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    const result = await convertPdf(new Uint8Array(0));
    expect(result).toBe('Hello PDF World');
  });

  test('handles multi-page PDF text', async () => {
    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 3,
          getPage: (n: number) => Promise.resolve({
            getTextContent: () => Promise.resolve({
              items: [{ str: `Page ${n} content` }],
            }),
          }),
        }),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    const result = await convertPdf(new Uint8Array(0));
    expect(result).toContain('Page 1 content');
    expect(result).toContain('Page 2 content');
    expect(result).toContain('Page 3 content');
  });

  test('handles empty PDF', async () => {
    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({
              items: [{ str: '   ' }],
            }),
          }),
        }),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    const result = await convertPdf(new Uint8Array(0));
    expect(result).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════
// convertDocx (mocked mammoth)
// ══════════════════════════════════════════════════════════════════

describe('convertDocx', () => {
  test('converts DOCX buffer to markdown using mammoth', async () => {
    mock.module('mammoth', () => ({
      default: {
        convertToMarkdown: async ({ buffer: _buf }: { buffer: Uint8Array }) => ({
          value: '# Heading\n\nParagraph text\n',
        }),
      },
    }));

    const result = await convertDocx(new Uint8Array(0));
    expect(result).toContain('# Heading');
    expect(result).toContain('Paragraph text');
  });

  test('handles styled headings via styleMap', async () => {
    let capturedStyleMap: string[] | undefined;

    mock.module('mammoth', () => ({
      default: {
        convertToMarkdown: async ({ buffer: _buf }: { buffer: Uint8Array }, opts: { styleMap?: string[] }) => {
          capturedStyleMap = opts.styleMap;
          return { value: '## Styled Heading' };
        },
      },
    }));

    const result = await convertDocx(new Uint8Array(0));
    expect(result).toBe('## Styled Heading');
    expect(capturedStyleMap).toHaveLength(6);
    expect(capturedStyleMap?.[0]).toContain("Heading 1");
    expect(capturedStyleMap?.[5]).toContain("Heading 6");
  });

  test('trims trailing whitespace', async () => {
    mock.module('mammoth', () => ({
      default: {
        convertToMarkdown: async () => ({ value: '  content  \n\n  ' }),
      },
    }));

    const result = await convertDocx(new Uint8Array(0));
    expect(result).toBe('content');
  });
});

// ══════════════════════════════════════════════════════════════════
// convertXlsx / convertOds (mocked xlsx)
// ══════════════════════════════════════════════════════════════════

describe('convertXlsx', () => {
  test('converts XLSX buffer to markdown tables', async () => {
    mock.module('xlsx', () => ({
      read: (_buf: Uint8Array) => ({
        SheetNames: ['Sheet1'],
        Sheets: {
          Sheet1: [['Name', 'Score'], ['Alice', '95']],
        },
      }),
      utils: {
        sheet_to_json: (sheet: unknown) => sheet,
      },
    }));

    const result = await convertXlsx(new Uint8Array(0));
    expect(result).toContain('# Sheet1');
    expect(result).toContain('| Name | Score |');
    expect(result).toContain('| Alice | 95 |');
  });
});

describe('convertOds', () => {
  test('converts ODS buffer using same sheet logic', async () => {
    mock.module('xlsx', () => ({
      read: (_buf: Uint8Array) => ({
        SheetNames: ['Data'],
        Sheets: {
          Data: [['Col1', 'Col2'], ['a', 'b']],
        },
      }),
      utils: {
        sheet_to_json: (sheet: unknown) => sheet,
      },
    }));

    const result = await convertOds(new Uint8Array(0));
    expect(result).toContain('# Data');
    expect(result).toContain('| Col1 | Col2 |');
  });
});

// ══════════════════════════════════════════════════════════════════
// convertPptx (mocked adm-zip + xml2js)
// ══════════════════════════════════════════════════════════════════

describe('convertPptx', () => {
  test('extracts text from slides sorted by number', async () => {
    const mockSlides = {
      'ppt/slides/slide2.xml': {
        'p:sld': { 'p:cSld': [{ 'p:spTree': { 'p:sp': [{ 'p:txBody': [{ 'a:p': [{ 'a:r': [{ 'a:t': 'Second Slide' }] }] }] }] } }] },
      },
      'ppt/slides/slide1.xml': {
        'p:sld': { 'p:cSld': [{ 'p:spTree': { 'p:sp': [{ 'p:txBody': [{ 'a:p': [{ 'a:r': [{ 'a:t': 'First Slide' }] }] }] }] } }] },
      },
    };

    mock.module('adm-zip', () => ({
      default: class MockAdmZip {
        constructor(_buf: Uint8Array) {}
        getEntries() {
          return Object.keys(mockSlides).map((name) => ({
            entryName: name,
            isDirectory: false,
          }));
        }
        readAsText(name: string) {
          return `<?xml version="1.0"?><root>${name}</root>`;
        }
      },
    }));

    mock.module('xml2js', () => ({
      Parser: class MockParser {
        parseStringPromise(_xml: string) {
          // Return slide content based on the order
          // Slides are sorted by number, so slide1 first, then slide2
          return mockSlides['ppt/slides/slide1.xml'] || mockSlides['ppt/slides/slide2.xml'];
        }
      },
    }));

    const result = await convertPptx(new Uint8Array(0));
    expect(result).toContain('Slide 1');
    expect(result).toContain('Slide 2');
  });

  test('handles empty presentation', async () => {
    mock.module('adm-zip', () => ({
      default: class MockAdmZip {
        constructor(_buf: Uint8Array) {}
        getEntries() { return []; }
        readAsText() { return ''; }
      },
    }));

    mock.module('xml2js', () => ({
      Parser: class MockParser {
        parseStringPromise() { return {}; }
      },
    }));

    const result = await convertPptx(new Uint8Array(0));
    expect(result).toBe('');
  });

  test('handles slide with no text content', async () => {
    mock.module('adm-zip', () => ({
      default: class MockAdmZip {
        constructor(_buf: Uint8Array) {}
        getEntries() {
          return [{ entryName: 'ppt/slides/slide1.xml' }];
        }
        readAsText() { return '<xml/>'; }
      },
    }));

    mock.module('xml2js', () => ({
      Parser: class MockParser {
        parseStringPromise() {
          return { 'p:sld': { 'p:cSld': [{ 'p:spTree': {} }] } };
        }
      },
    }));

    const result = await convertPptx(new Uint8Array(0));
    expect(result).toContain('# Slide 1');
  });
});

// ══════════════════════════════════════════════════════════════════
// convertOdt (mocked adm-zip + xml2js)
// ══════════════════════════════════════════════════════════════════

describe('convertOdt', () => {
  test('extracts paragraphs and headings from ODT content', async () => {
    mock.module('adm-zip', () => ({
      default: class MockAdmZip {
        constructor(_buf: Uint8Array) {}
        getEntry(name: string) {
          if (name === 'content.xml') return { entryName: 'content.xml' };
          return null;
        }
        readAsText(name: string) {
          if (name === 'content.xml') return '<?xml?>';
          return '';
        }
      },
    }));

    mock.module('xml2js', () => ({
      Parser: class MockParser {
        parseStringPromise() {
          return {
            'office:document-content': {
              'office:body': [{
                'office:text': [{
                  'text:h': [{ _: 'My Heading', $: { 'text:outline-level': '2' } }],
                  'text:p': [{ _: 'Hello from ODT' }],
                }],
              }],
            },
          };
        }
      },
    }));

    const result = await convertOdt(new Uint8Array(0));
    expect(result).toContain('## My Heading');
    expect(result).toContain('Hello from ODT');
  });

  test('returns message when no content.xml found', async () => {
    mock.module('adm-zip', () => ({
      default: class MockAdmZip {
        constructor(_buf: Uint8Array) {}
        getEntry() { return null; }
        readAsText() { return ''; }
      },
    }));

    mock.module('xml2js', () => ({
      Parser: class MockParser {
        parseStringPromise() { return {}; }
      },
    }));

    const result = await convertOdt(new Uint8Array(0));
    expect(result).toContain('No content found');
  });

  test('handles lists in ODT', async () => {
    mock.module('adm-zip', () => ({
      default: class MockAdmZip {
        constructor(_buf: Uint8Array) {}
        getEntry(name: string) {
          if (name === 'content.xml') return { entryName: 'content.xml' };
          return null;
        }
        readAsText(name: string) {
          if (name === 'content.xml') return '<?xml?>';
          return '';
        }
      },
    }));

    mock.module('xml2js', () => ({
      Parser: class MockParser {
        parseStringPromise() {
          return {
            'office:document-content': {
              'office:body': [{
                'office:text': [{
                  'text:list': [{
                    'text:list-item': [
                      { 'text:p': [{ _: 'Item one' }] },
                      { 'text:p': [{ _: 'Item two' }] },
                    ],
                  }],
                }],
              }],
            },
          };
        }
      },
    }));

    const result = await convertOdt(new Uint8Array(0));
    expect(result).toContain('- Item one');
    expect(result).toContain('- Item two');
  });

  test('handles tables in ODT', async () => {
    mock.module('adm-zip', () => ({
      default: class MockAdmZip {
        constructor(_buf: Uint8Array) {}
        getEntry(name: string) {
          if (name === 'content.xml') return { entryName: 'content.xml' };
          return null;
        }
        readAsText(name: string) {
          if (name === 'content.xml') return '<?xml?>';
          return '';
        }
      },
    }));

    mock.module('xml2js', () => ({
      Parser: class MockParser {
        parseStringPromise() {
          return {
            'office:document-content': {
              'office:body': [{
                'office:text': [{
                  'table:table': [{
                    'table:table-row': [
                      {
                        'table:table-cell': [
                          { 'text:p': [{ _: 'Header 1' }] },
                          { 'text:p': [{ _: 'Header 2' }] },
                        ],
                      },
                      {
                        'table:table-cell': [
                          { 'text:p': [{ _: 'Data 1' }] },
                          { 'text:p': [{ _: 'Data 2' }] },
                        ],
                      },
                    ],
                  }],
                }],
              }],
            },
          };
        }
      },
    }));

    const result = await convertOdt(new Uint8Array(0));
    expect(result).toContain('| Header 1 | Header 2 |');
    expect(result).toContain('| --- | --- |');
    expect(result).toContain('| Data 1 | Data 2 |');
  });
});

// ══════════════════════════════════════════════════════════════════
// convertOdp (mocked adm-zip + xml2js)
// ══════════════════════════════════════════════════════════════════

describe('convertOdp', () => {
  test('extracts slides from ODP presentation', async () => {
    mock.module('adm-zip', () => ({
      default: class MockAdmZip {
        constructor(_buf: Uint8Array) {}
        getEntry(name: string) {
          if (name === 'content.xml') return { entryName: 'content.xml' };
          return null;
        }
        readAsText(name: string) {
          if (name === 'content.xml') return '<?xml?>';
          return '';
        }
      },
    }));

    mock.module('xml2js', () => ({
      Parser: class MockParser {
        parseStringPromise() {
          return {
            'office:document-content': {
              'office:body': [{
                'office:presentation': [{
                  'draw:page': [
                    { 'draw:frame': [{ 'draw:text-box': [{ 'text:p': [{ 'text:span': [{ _: 'Welcome' }] }] }] }] },
                    { 'draw:frame': [{ 'draw:text-box': [{ 'text:p': [{ 'text:span': [{ _: 'Thank you' }] }] }] }] },
                  ],
                }],
              }],
            },
          };
        }
      },
    }));

    const result = await convertOdp(new Uint8Array(0));
    expect(result).toContain('# Slide 1');
    expect(result).toContain('# Slide 2');
    expect(result).toContain('Welcome');
    expect(result).toContain('Thank you');
  });

  test('returns message when no content.xml', async () => {
    mock.module('adm-zip', () => ({
      default: class MockAdmZip {
        constructor(_buf: Uint8Array) {}
        getEntry() { return null; }
        readAsText() { return ''; }
      },
    }));

    mock.module('xml2js', () => ({
      Parser: class MockParser {
        parseStringPromise() { return {}; }
      },
    }));

    const result = await convertOdp(new Uint8Array(0));
    expect(result).toContain('No content found');
  });
});

// ══════════════════════════════════════════════════════════════════
// convertZip (mocked adm-zip)
// ══════════════════════════════════════════════════════════════════

describe('convertZip', () => {
  test('lists directory entries and text file contents', async () => {
    mock.module('adm-zip', () => ({
      default: class MockAdmZip {
        constructor(_buf: Uint8Array) {}
        getEntries() {
          return [
            { entryName: 'folder/', isDirectory: true },
            { entryName: 'folder/readme.txt', isDirectory: false },
            { entryName: 'folder/data.json', isDirectory: false },
          ];
        }
        readAsText(name: string) {
          if (name === 'folder/readme.txt') return 'Hello world';
          if (name === 'folder/data.json') return '{"key": "value"}';
          return '';
        }
      },
    }));

    const result = await convertZip(new Uint8Array(0));
    expect(result).toContain('### folder/');
    expect(result).toContain('### folder/readme.txt');
    expect(result).toContain('```txt');
    expect(result).toContain('Hello world');
    expect(result).toContain('```json');
    expect(result).toContain('{"key": "value"}');
  });

  test('marks binary files as binary', async () => {
    mock.module('adm-zip', () => ({
      default: class MockAdmZip {
        constructor(_buf: Uint8Array) {}
        getEntries() {
          return [
            { entryName: 'image.png', isDirectory: false },
            { entryName: 'program.exe', isDirectory: false },
          ];
        }
        readAsText() { return ''; }
      },
    }));

    const result = await convertZip(new Uint8Array(0));
    expect(result).toContain('*Binary file*');
  });

  test('handles empty zip', async () => {
    mock.module('adm-zip', () => ({
      default: class MockAdmZip {
        constructor(_buf: Uint8Array) {}
        getEntries() { return []; }
        readAsText() { return ''; }
      },
    }));

    const result = await convertZip(new Uint8Array(0));
    expect(result).toBe('');
  });

  test('sorts entries alphabetically', async () => {
    const entries = [
      { entryName: 'z-last.txt', isDirectory: false },
      { entryName: 'a-first.txt', isDirectory: false },
    ];

    mock.module('adm-zip', () => ({
      default: class MockAdmZip {
        constructor(_buf: Uint8Array) {}
        getEntries() {
          return entries.sort((a, b) => a.entryName.localeCompare(b.entryName));
        }
        readAsText(name: string) {
          return name === 'a-first.txt' ? 'AAA' : 'ZZZ';
        }
      },
    }));

    const result = await convertZip(new Uint8Array(0));
    const firstIdx = result.indexOf('a-first.txt');
    const lastIdx = result.indexOf('z-last.txt');
    expect(firstIdx).toBeLessThan(lastIdx);
  });
});

// ══════════════════════════════════════════════════════════════════
// execute() — Integration Tests
// ══════════════════════════════════════════════════════════════════

describe('file-to-markdown execute()', () => {
  test('returns error for unsupported file format', async () => {
    vfs.writeFile(`${WORKSPACE}/file.txt`, 'plain text');

    const result = await execute({ path: `${WORKSPACE}/file.txt` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported file format');
  });

  test('returns error when file not found', async () => {
    const result = await execute({ path: `${WORKSPACE}/missing.pdf` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('returns error when path is a directory', async () => {
    vfs.addDir(`${WORKSPACE}/docs`);
    const result = await execute({ path: `${WORKSPACE}/docs` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('directory');
  });

  test('returns error for file exceeding 50MB', async () => {
    // Create a VirtualFS with a file that has inflated size
    const bigVfs = new VirtualFS();
    bigVfs.writeFile(`${WORKSPACE}/big.pdf`, 'x');

    // Override stat to return a large size
    const bigCtx = createMockContext(bigVfs);
    const originalStat = bigCtx.fs.stat;
    bigCtx.fs.stat = mock(async (path: string) => {
      const s = await originalStat(path);
      if (s && path.endsWith('.pdf')) {
        return { ...s, size: 60 * 1024 * 1024 }; // 60MB
      }
      return s;
    });

    const result = await execute({ path: `${WORKSPACE}/big.pdf` }, bigCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('too large');
  });

  test('converts PDF file and returns line-numbered content', async () => {
    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({
              items: [{ str: 'Hello PDF\nSecond line\nThird line' }],
            }),
          }),
        }),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    vfs.writeFile(`${WORKSPACE}/doc.pdf`, 'fake-pdf-content');

    const result = await execute({ path: `${WORKSPACE}/doc.pdf` }, ctx);
    expect(result.success).toBe(true);

    const res = result.result as { content: string };
    expect(res.content).toContain('1: Hello PDF');
    expect(res.content).toContain('2: Second line');
    expect(res.content).toContain('3: Third line');
    expect(res.content).toContain('End of converted markdown');
  });

  test('converts DOCX file successfully', async () => {
    mock.module('mammoth', () => ({
      default: {
        convertToMarkdown: async () => ({ value: '# Title\n\nBody paragraph' }),
      },
    }));

    vfs.writeFile(`${WORKSPACE}/doc.docx`, 'fake-docx-content');

    const result = await execute({ path: `${WORKSPACE}/doc.docx` }, ctx);
    expect(result.success).toBe(true);
    const res = result.result as { content: string };
    expect(res.content).toContain('Title');
    expect(res.content).toContain('Body paragraph');
  });

  test('converts XLSX file successfully', async () => {
    mock.module('xlsx', () => ({
      read: () => ({
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: [['A', 'B'], ['1', '2']] },
      }),
      utils: { sheet_to_json: (s: unknown) => s },
    }));

    vfs.writeFile(`${WORKSPACE}/sheet.xlsx`, 'fake-xlsx-content');

    const result = await execute({ path: `${WORKSPACE}/sheet.xlsx` }, ctx);
    expect(result.success).toBe(true);
    const res = result.result as { content: string };
    expect(res.content).toContain('Sheet1');
    expect(res.content).toContain('| A | B |');
  });

  test('converts ZIP file successfully', async () => {
    mock.module('adm-zip', () => ({
      default: class {
        constructor(_buf: Uint8Array) {}
        getEntries() {
          return [{ entryName: 'readme.txt', isDirectory: false }];
        }
        readAsText() { return 'Zip contents'; }
      },
    }));

    vfs.writeFile(`${WORKSPACE}/archive.zip`, 'fake-zip-content');

    const result = await execute({ path: `${WORKSPACE}/archive.zip` }, ctx);
    expect(result.success).toBe(true);
    const res = result.result as { content: string };
    expect(res.content).toContain('readme.txt');
  });

  test('respects offset parameter', async () => {
    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({
              items: [{ str: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5' }],
            }),
          }),
        }),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    vfs.writeFile(`${WORKSPACE}/doc.pdf`, 'fake-pdf-content');

    const result = await execute({ path: `${WORKSPACE}/doc.pdf`, offset: 3 }, ctx);
    expect(result.success).toBe(true);
    const res = result.result as { content: string };
    expect(res.content).toContain('3: Line 3');
    expect(res.content).not.toContain('1: Line 1');
    expect(res.content).not.toContain('2: Line 2');
  });

  test('respects limit parameter', async () => {
    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({
              items: [{ str: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5' }],
            }),
          }),
        }),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    vfs.writeFile(`${WORKSPACE}/doc.pdf`, 'fake-pdf-content');

    const result = await execute({ path: `${WORKSPACE}/doc.pdf`, limit: 2 }, ctx);
    expect(result.success).toBe(true);
    const res = result.result as { content: string };
    expect(res.content).toContain('1: Line 1');
    expect(res.content).toContain('2: Line 2');
    expect(res.content).not.toContain('3: Line 3');
    expect(res.content).toContain('Showing lines 1-2 of 5');
  });

  test('returns error for offset less than 1', async () => {
    vfs.writeFile(`${WORKSPACE}/doc.pdf`, 'fake-pdf-content');

    // We need the file to exist so the tool gets past stat checks
    // But offset validation happens after conversion, so we need a converter mock
    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({
              items: [{ str: 'content' }],
            }),
          }),
        }),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    const result = await execute({ path: `${WORKSPACE}/doc.pdf`, offset: 0 }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('offset must be greater than or equal to 1');
  });

  test('shows truncation message when content exceeds MAX_BYTES', async () => {
    // Create a long document that exceeds the 50KB line limit
    const lines = Array.from({ length: 5000 }, (_, i) => `Line ${i + 1}: ${'x'.repeat(100)}`);
    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({
              items: lines.map((line) => ({ str: line })),
            }),
          }),
        }),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    vfs.writeFile(`${WORKSPACE}/big.pdf`, 'fake-pdf-content');

    const result = await execute({ path: `${WORKSPACE}/big.pdf` }, ctx);
    expect(result.success).toBe(true);
    const res = result.result as { content: string };
    // Should have a truncation/continuation message
    expect(res.content).toMatch(/Showing lines|End of converted/);
  });

  test('truncates lines longer than 2000 chars', async () => {
    const longLine = 'A'.repeat(3000);
    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({
              items: [{ str: longLine }],
            }),
          }),
        }),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    vfs.writeFile(`${WORKSPACE}/doc.pdf`, 'fake-pdf-content');

    const result = await execute({ path: `${WORKSPACE}/doc.pdf` }, ctx);
    expect(result.success).toBe(true);
    const res = result.result as { content: string };
    expect(res.content).toContain('truncated to 2000 chars');
  });
});

// ══════════════════════════════════════════════════════════════════
// execute() — Caching
// ══════════════════════════════════════════════════════════════════

describe('file-to-markdown caching', () => {
  test('writes converted result to cache', async () => {
    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({
              items: [{ str: 'Cached content' }],
            }),
          }),
        }),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    vfs.writeFile(`${WORKSPACE}/doc.pdf`, 'fake-pdf-content');

    const result = await execute({ path: `${WORKSPACE}/doc.pdf` }, ctx);
    expect(result.success).toBe(true);

    const res = result.result as { cachePath: string };
    expect(res.cachePath).toContain('file-to-markdown-');
    expect(res.cachePath).toContain('.md');
  });

  test('reads from cache on second call (no converter invocation)', async () => {
    let converterCalls = 0;

    mock.module('pdfjs-dist', () => ({
      getDocument: () => {
        converterCalls++;
        return {
          promise: Promise.resolve({
            numPages: 1,
            getPage: () => Promise.resolve({
              getTextContent: () => Promise.resolve({
                items: [{ str: 'Original content' }],
              }),
            }),
          }),
        };
      },
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    vfs.writeFile(`${WORKSPACE}/doc.pdf`, 'fake-pdf-content');

    // First call — should invoke converter
    const first = await execute({ path: `${WORKSPACE}/doc.pdf` }, ctx);
    expect(first.success).toBe(true);
    expect(converterCalls).toBe(1);

    // The cache should have been written to VFS
    const firstRes = first.result as { cachePath: string };
    expect(vfs.hasFile(firstRes.cachePath)).toBe(true);

    // Second call — should read from cache
    const second = await execute({ path: `${WORKSPACE}/doc.pdf` }, ctx);
    expect(second.success).toBe(true);
    // Converter should NOT have been called again
    expect(converterCalls).toBe(1);

    // Visualization should indicate "from cache"
    const viz = second.visualization as { type: string; message?: string };
    expect(viz?.message).toContain('from cache');
  });
});

// ══════════════════════════════════════════════════════════════════
// execute() — Permissions
// ══════════════════════════════════════════════════════════════════

describe('file-to-markdown permissions', () => {
  test('blocked path returns error', async () => {
    const result = await execute({ path: '/etc/passwd.pdf' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('system directories');
  });

  test('outside workspace path requires permission', async () => {
    const outsideCtx = createMockContext(vfs, {
      ask: mock(async () => true) as unknown as typeof ctx.ask,
    });
    vfs.writeFile('/tmp/external/doc.pdf', 'fake-pdf-content');


    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({
              items: [{ str: 'External content' }],
            }),
          }),
        }),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    const result = await execute({ path: '/tmp/external/doc.pdf' }, outsideCtx);
    expect(outsideCtx.ask).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  test('outside workspace rejection returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });
    vfs.writeFile('/tmp/external/doc.pdf', 'fake-pdf-content');

    const result = await execute({ path: '/tmp/external/doc.pdf' }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
  });

  test('sensitive path requires permission', async () => {
    const sensitiveCtx = createMockContext(vfs, {
      ask: mock(async () => true) as unknown as typeof ctx.ask,
    });
    vfs.writeFile(`${WORKSPACE}/.env.pdf`, 'fake-pdf-content');


    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({
              items: [{ str: 'Sensitive content' }],
            }),
          }),
        }),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    const result = await execute({ path: `${WORKSPACE}/.env.pdf` }, sensitiveCtx);
    expect(sensitiveCtx.ask).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  test('sensitive path rejection returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });
    vfs.writeFile(`${WORKSPACE}/.env.pdf`, 'fake-pdf-content');

    const result = await execute({ path: `${WORKSPACE}/.env.pdf` }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
  });

  test('allowed path does not require permission', async () => {
    const allowedCtx = createMockContext(vfs, {
      allowedPaths: ['/data'],
      ask: mock(async () => {
        throw new Error('Should not ask for permission');
      }) as unknown as typeof ctx.ask,
    });
    vfs.writeFile('/data/docs/report.pdf', 'fake-pdf-content');

    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({
              items: [{ str: 'Report content' }],
            }),
          }),
        }),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    const result = await execute({ path: '/data/docs/report.pdf' }, allowedCtx);
    expect(result.success).toBe(true);
    const res = result.result as { content: string };
    expect(res.content).toContain('Report content');
  });
});

// ══════════════════════════════════════════════════════════════════
// execute() — Error handling
// ══════════════════════════════════════════════════════════════════

describe('file-to-markdown error handling', () => {
  test('handles converter throwing an error', async () => {
    mock.module('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.reject(new Error('Corrupt PDF')),
      }),
      GlobalWorkerOptions: { workerSrc: '' },
    }));

    vfs.writeFile(`${WORKSPACE}/broken.pdf`, 'corrupted-data');

    const result = await execute({ path: `${WORKSPACE}/broken.pdf` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Corrupt PDF');
  });

  test('handles unsupported format gracefully', async () => {
    vfs.writeFile(`${WORKSPACE}/file.rtf`, 'rich text');

    const result = await execute({ path: `${WORKSPACE}/file.rtf` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported file format');
  });
});
