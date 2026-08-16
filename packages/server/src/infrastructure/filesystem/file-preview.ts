/**
 * Filesystem infrastructure implementation (S5 filesystem isolation).
 * File preview: the exact pre-slice pipeline including the C6 workspace
 * path policy containment (the accepted preview tightening). The
 * containment check is injected so the infrastructure layer imports no
 * adapters or store modules.
 */

import { stat, readFile } from 'fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'path';
import type { FilePreviewResponse } from '@jean2/sdk';
import {
  FILE_PREVIEW_MAX_BYTES,
  isBinaryExtension,
  isBinaryFile,
} from '@/utils/binaryDetection';

const CODE_EXTENSIONS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  py: 'python',
  pyw: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  dart: 'dart',
  lua: 'lua',
  r: 'r',
  R: 'r',
  pl: 'perl',
  pm: 'perl',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hrl: 'erlang',
  cljs: 'clojure',
  clj: 'clojure',
  hs: 'haskell',
  lhs: 'haskell',
  scala: 'scala',
  sc: 'scala',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  tf: 'hcl',
  hcl: 'hcl',
  proto: 'protobuf',
  gradle: 'groovy',
  vim: 'vim',
  diff: 'diff',
  patch: 'diff',
  env: 'ini',
  lock: 'json',
};

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

const MIME_MAP: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'text/xml',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.py': 'text/x-python',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.sh': 'text/x-shellscript',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/toml',
  '.sql': 'text/x-sql',
};

const SPECIAL_FILENAMES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};

function getLanguage(ext: string | undefined): string | undefined {
  if (!ext) return undefined;

  const name = basename(ext);

  if (SPECIAL_FILENAMES[name.toLowerCase()]) {
    return SPECIAL_FILENAMES[name.toLowerCase()];
  }

  const key = name.startsWith('.') ? name.slice(1).toLowerCase() : name.toLowerCase();
  return CODE_EXTENSIONS[key];
}

export function getLanguageForPath(filePath: string): string | undefined {
  const ext = extname(filePath);
  return getLanguage(ext);
}

export function getMimeTypeForPath(filePath: string): string | undefined {
  const ext = extname(filePath);
  return ext ? MIME_MAP[ext.toLowerCase()] : undefined;
}

/** The injected C6 workspace path policy containment check. */
export interface PreviewContainment {
  isPathWithinWorkspace(
    targetPath: string,
    workspacePath: string,
    additionalPaths?: string[],
  ): boolean;
}

/** Builds the preview function over the injected containment check. */
export function createFilePreview(containment: PreviewContainment) {
  return async function getFilePreview(
    workspacePath: string,
    relativePath: string,
    additionalPaths: string[] = [],
  ): Promise<FilePreviewResponse> {
    let fullPath: string;
    const normalizedInput = relativePath.replace(/\\/g, '/');

    if (isAbsolute(normalizedInput)) {
      fullPath = resolve(normalizedInput);
    } else {
      fullPath = join(workspacePath, normalizedInput);
    }

    // C6 step 4: the naive prefix containment is replaced by the Capek
    // workspace policy's separator-aware containment. This fails closed for
    // sibling-prefix paths (`/main-other` under `/main`) and for `..`
    // traversal that resolves outside the allowed roots; every previously
    // allowed path stays allowed.
    if (!containment.isPathWithinWorkspace(fullPath, workspacePath, additionalPaths)) {
      throw new Error('Path outside workspace');
    }

    const primaryResolved = resolve(workspacePath);

    const responseRelativePath = fullPath === primaryResolved
      ? ''
      : fullPath.startsWith(primaryResolved)
        ? fullPath.slice(primaryResolved.length + 1)
        : fullPath;

    const fileName = basename(responseRelativePath);
    const extension = extname(responseRelativePath);

    let stats;
    try {
      stats = await stat(fullPath);
    } catch {
      throw new Error('File not found');
    }

    if (stats.isDirectory()) {
      throw new Error('Cannot preview a directory');
    }

    const size = stats.size;

    if (size > FILE_PREVIEW_MAX_BYTES) {
      return {
        path: responseRelativePath,
        name: fileName,
        extension,
        size,
        kind: 'too_large',
        readOnly: true as const,
        reason: 'File is too large for preview',
        maxBytes: FILE_PREVIEW_MAX_BYTES,
      };
    }

    if (isBinaryExtension(extension)) {
      return {
        path: responseRelativePath,
        name: fileName,
        extension,
        size,
        kind: 'binary',
        readOnly: true as const,
        reason: 'Binary file type not supported for preview',
      };
    }

    const binary = await isBinaryFile(fullPath, size);
    if (binary) {
      return {
        path: responseRelativePath,
        name: fileName,
        extension,
        size,
        kind: 'binary',
        readOnly: true as const,
        reason: 'File content appears to be binary',
      };
    }

    const extLower = extension.toLowerCase();
    let kind: 'code' | 'text' | 'markdown' = 'text';

    if (MARKDOWN_EXTENSIONS.has(extLower)) {
      kind = 'markdown';
    } else if (getLanguage(extension)) {
      kind = 'code';
    }

    let content: string;
    try {
      content = await readFile(fullPath, 'utf-8');
    } catch {
      return {
        path: responseRelativePath,
        name: fileName,
        extension,
        size,
        kind: 'unsupported',
        readOnly: true as const,
        reason: 'File encoding is not supported for preview',
      };
    }

    return {
      path: responseRelativePath,
      name: fileName,
      extension,
      size,
      kind,
      readOnly: true as const,
      language: getLanguage(extension),
      mimeType: extension ? MIME_MAP[extension.toLowerCase()] : undefined,
      content,
    };
  };
}
