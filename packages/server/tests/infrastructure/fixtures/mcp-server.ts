// Offline stdio fixture: no provider calls or external packages.
export {};
let buffer = '';
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  let end: number;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.id === undefined) continue;
    const result = message.method === 'initialize'
      ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : message.method === 'tools/list'
        ? { tools: [{ name: 'read_records', description: 'Read records', inputSchema: { type: 'object', properties: {} } },
          { name: 'write_records', description: 'Write records', inputSchema: { type: 'object', properties: {} } }] }
        : message.method === 'tools/call'
          ? { content: [{ type: 'text', text: JSON.stringify({ tool: message.params.name, args: message.params.arguments }) }] }
          : {};
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
  }
}
