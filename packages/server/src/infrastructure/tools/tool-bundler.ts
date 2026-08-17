import { existsSync } from 'fs';
import { join } from 'path';

export class ToolBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolBundleError';
  }
}

export interface BundleResult {
  outputPath: string;
  size: number;
}

export async function bundleTool(
  toolDir: string,
  entry: string,
): Promise<BundleResult> {
  const entryPath = join(toolDir, entry);

  if (!existsSync(entryPath)) {
    throw new ToolBundleError(`Entry file not found: ${entryPath}`);
  }

  const outputPath = join(toolDir, 'tool.js');

  try {
    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir: toolDir,
      naming: '[name].[ext]',
      target: 'bun',
      format: 'esm',
      minify: false,
      sourcemap: 'none',
      external: [],
    });

    if (!result.success) {
      const errors = result.logs.map((log) => String(log)).join('\n');
      throw new ToolBundleError(`Bun.build() failed:\n${errors}`);
    }

    const output = result.outputs[0];
    if (!output) {
      throw new ToolBundleError('Bun.build() produced no output');
    }

    const size = output.size;

    return {
      outputPath,
      size,
    };
  } catch (err: unknown) {
    if (err instanceof ToolBundleError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ToolBundleError(`Bundle failed: ${message}`);
  }
}
