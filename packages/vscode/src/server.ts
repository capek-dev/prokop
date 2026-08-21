import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { state } from './state';

export function startStaticServer(rootDir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${state.serverPort}`);
      const urlPath = url.pathname === '/' || url.pathname === '' ? 'index.html' : url.pathname.slice(1);
      const resolved = path.resolve(rootDir, urlPath);
      if (!resolved.startsWith(path.resolve(rootDir) + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }

      try {
        const stat = fs.statSync(resolved);
        const servePath = stat.isDirectory() ? path.join(resolved, 'index.html') : resolved;
        const content = fs.readFileSync(servePath);
        const ext = path.extname(servePath);
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.mjs': 'application/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.png': 'image/png',
          '.ico': 'image/x-icon',
          '.svg': 'image/svg+xml',
          '.woff2': 'font/woff2',
          '.mp3': 'audio/mpeg',
          '.webmanifest': 'application/manifest+json',
        };
        res.writeHead(200, {
          'Content-Type': mimeTypes[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) {
        state.serverPort = addr.port;
      }
      console.log(`[prokopaicode] Static server ready on http://127.0.0.1:${state.serverPort}`);
      resolve(state.serverPort);
    });

    server.on('error', reject);
    state.server = server;
  });
}

export function stopServer() {
  if (state.server) {
    state.server.close();
    state.server = null;
    state.serverPort = 0;
  }
}
