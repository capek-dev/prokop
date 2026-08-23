import { existsSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';

import { getClientEnabled } from '@/infrastructure/runtime/environment';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
};

const REVALIDATE_FILES = new Set([
  'index.html',
  'sw.js',
  'registerSW.js',
  'manifest.webmanifest',
]);

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function getEmbeddedClientAssetsRoot(): string | null {
  const bunRuntime = Bun as typeof Bun & { isStandaloneExecutable?: boolean };
  if (!getClientEnabled() || bunRuntime.isStandaloneExecutable !== true) return null;

  const root = join(import.meta.dir, 'dist');
  return isFile(join(root, 'index.html')) ? root : null;
}

export function resolveClientAssetPath(root: string, relativePath: string): string | null {
  const normalized = normalize(relativePath);
  if (isAbsolute(normalized) || normalized.split(sep).includes('..')) return null;

  const resolvedRoot = resolve(root);
  const filePath = resolve(resolvedRoot, normalized);
  if (filePath === resolvedRoot || filePath.startsWith(`${resolvedRoot}${sep}`)) {
    return filePath;
  }
  return null;
}

export function getClientAssetContentType(relativePath: string): string {
  return MIME_TYPES[extname(relativePath).toLowerCase()] ?? 'application/octet-stream';
}

export function getClientAssetCacheControl(relativePath: string): string {
  const filename = basename(relativePath);
  if (REVALIDATE_FILES.has(filename)) return 'no-cache';

  const pathParts = relativePath.split(/[\\/]/);
  const hasContentHash = /[-.][A-Za-z0-9_]{8,}(?=\.)/.test(filename);
  if (pathParts.includes('assets') && hasContentHash) {
    return 'public, max-age=31536000, immutable';
  }

  return 'no-cache';
}

export function isClientSpaNavigation(request: Request, pathname: string): boolean {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;

  const extension = extname(pathname).toLowerCase();
  if (extension && extension !== '.html') return false;

  const fetchMode = request.headers.get('sec-fetch-mode');
  const accept = request.headers.get('accept') ?? '';
  if (fetchMode === 'navigate' || accept.includes('text/html')) return true;
  if (fetchMode || accept) return false;
  return true;
}

function responseForFile(request: Request, filePath: string, relativePath: string): Response {
  const headers = {
    'Content-Type': getClientAssetContentType(relativePath),
    'Cache-Control': getClientAssetCacheControl(relativePath),
  };

  if (request.method.toUpperCase() === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  return new Response(Bun.file(filePath), { status: 200, headers });
}

function findClientAsset(root: string, relativePath: string): string | null {
  const filePath = resolveClientAssetPath(root, relativePath);
  return filePath !== null && isFile(filePath) ? filePath : null;
}

export async function createClientAssetResponse(
  request: Request,
  root: string,
): Promise<Response | null> {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return null;
  }

  if (pathname.includes('\0') || pathname.includes('\\')) return null;

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (relativePath.split('/').includes('..')) return null;

  const assetPath = findClientAsset(root, relativePath);
  if (assetPath !== null) {
    return responseForFile(request, assetPath, relativePath);
  }

  const extension = extname(pathname).toLowerCase();
  if (extension && extension !== '.html') {
    const recoveredRelativePath = join('assets', basename(pathname));
    const recoveredPath = findClientAsset(root, recoveredRelativePath);
    return recoveredPath === null
      ? null
      : responseForFile(request, recoveredPath, recoveredRelativePath);
  }

  if (!isClientSpaNavigation(request, pathname)) return null;

  const indexPath = findClientAsset(root, 'index.html');
  return indexPath === null ? null : responseForFile(request, indexPath, 'index.html');
}

export function hasClientAssets(root: string | null): root is string {
  return root !== null && existsSync(join(root, 'index.html'));
}
