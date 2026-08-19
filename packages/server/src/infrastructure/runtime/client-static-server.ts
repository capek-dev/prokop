import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';

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

export function getStaticCacheControl(filePath: string): string {
  const filename = path.basename(filePath);
  if (REVALIDATE_FILES.has(filename)) return 'no-cache';

  const isAsset = filePath.split(path.sep).includes('assets');
  const hasContentHash = /[-.][A-Za-z0-9_]{8,}(?=\.)/.test(filename);
  if (isAsset && hasContentHash) return 'public, max-age=31536000, immutable';

  return 'no-cache';
}

export function isSpaNavigationRequest(req: IncomingMessage, urlPath: string): boolean {
  const method = req.method?.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;

  const extension = path.extname(urlPath).toLowerCase();
  if (extension && extension !== '.html') return false;

  const fetchMode = req.headers['sec-fetch-mode'];
  const accept = req.headers.accept ?? '';
  if (fetchMode === 'navigate' || accept.includes('text/html')) return true;
  if (fetchMode || accept) return false;
  return true;
}

function getContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_TYPES[extension] || 'application/octet-stream';
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function serveFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
): Promise<void> {
  try {
    const data = req.method === 'HEAD' ? null : await fs.promises.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': getContentType(filePath),
      'Cache-Control': getStaticCacheControl(filePath),
    });
    res.end(data);
  } catch {
    respondNotFound(res);
  }
}

function respondNotFound(res: ServerResponse): void {
  res.writeHead(404, {
    'Content-Type': 'text/plain',
    'Cache-Control': 'no-cache',
  });
  res.end('Not Found');
}

export function createStaticRequestHandler(distPath: string): RequestListener {
  return (req, res) => {
    void (async () => {
      const method = req.method?.toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }

      const requestUrl = new URL(req.url ?? '/', 'http://localhost');
      let urlPath: string;
      try {
        urlPath = decodeURIComponent(requestUrl.pathname);
      } catch {
        respondNotFound(res);
        return;
      }

      if (urlPath === '/') urlPath = '/index.html';

      const relativePath = urlPath.replace(/^\/+/, '');
      const filePath = path.resolve(distPath, relativePath);
      const distRoot = `${path.resolve(distPath)}${path.sep}`;
      if (filePath !== path.resolve(distPath) && !filePath.startsWith(distRoot)) {
        respondNotFound(res);
        return;
      }

      if (await isFile(filePath)) {
        await serveFile(req, res, filePath);
        return;
      }

      const extension = path.extname(urlPath).toLowerCase();
      if (extension && extension !== '.html') {
        const assetPath = path.join(distPath, 'assets', path.basename(urlPath));
        if (await isFile(assetPath)) {
          await serveFile(req, res, assetPath);
          return;
        }
        respondNotFound(res);
        return;
      }

      if (!isSpaNavigationRequest(req, urlPath)) {
        respondNotFound(res);
        return;
      }

      await serveFile(req, res, path.join(distPath, 'index.html'));
    })().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[client] Static request failed:', message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      res.end('Internal Server Error');
    });
  };
}
