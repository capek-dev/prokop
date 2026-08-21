import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { createStaticRequestHandler } from './staticServer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = __dirname;

const { values } = parseArgs({
  options: {
    port: {
      type: 'string',
      default: '3774',
    },
  },
  argv: process.argv.slice(2),
});

const PORT = parseInt(values.port, 10);
const server = http.createServer(createStaticRequestHandler(distPath));

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Prokopai client running at http://localhost:${PORT}`);
});

function shutdown(): void {
  console.log('\nShutting down...');
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
