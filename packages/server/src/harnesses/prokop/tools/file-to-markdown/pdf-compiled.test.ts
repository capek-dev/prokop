import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('compiled PDF conversion', () => {
  test('embeds the PDF.js worker in a Bun executable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'prokop-pdf-compiled-'));
    temporaryDirectories.push(directory);
    const entrypoint = join(directory, 'entry.ts');
    const executable = join(directory, process.platform === 'win32' ? 'pdf-smoke.exe' : 'pdf-smoke');
    const toolPath = join(import.meta.dir, 'tool.ts');

    await Bun.write(entrypoint, `
import { convertPdf } from ${JSON.stringify(toolPath)};

function createPdf(text: string): Uint8Array {
  const stream = \`BT /F1 18 Tf 72 720 Td (\${text}) Tj ET\`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    \`<< /Length \${Buffer.byteLength(stream)} >>\\nstream\\n\${stream}\\nendstream\`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += \`\${index + 1} 0 obj\\n\${object}\\nendobj\\n\`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += \`xref\\n0 \${objects.length + 1}\\n0000000000 65535 f \\n\`;
  pdf += offsets.map((offset) => \`\${offset.toString().padStart(10, '0')} 00000 n \\n\`).join('');
  pdf += \`trailer\\n<< /Size \${objects.length + 1} /Root 1 0 R >>\\nstartxref\\n\${xrefOffset}\\n%%EOF\\n\`;
  return new TextEncoder().encode(pdf);
}

const markdown = await convertPdf(createPdf('Compiled PDF'));
if (markdown !== 'Compiled PDF') {
  throw new Error(\`Unexpected conversion output: \${JSON.stringify(markdown)}\`);
}
console.log(markdown);
`);

    const build = Bun.spawnSync([
      process.execPath,
      'build',
      '--compile',
      `--outfile=${executable}`,
      entrypoint,
    ], {
      cwd: import.meta.dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(build.stderr.toString()).toBe('');
    expect(build.exitCode).toBe(0);

    const run = Bun.spawnSync([executable], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(run.stderr.toString()).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toContain('Compiled PDF');
  }, 120_000);
});
