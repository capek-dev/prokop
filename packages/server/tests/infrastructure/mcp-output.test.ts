import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { createAgentScope, createProcessScope } from '@capekai/core/composition';
import { toolOutputPolicyPlugin } from '@capekai/core/plugins';
import { mcpModelOutput, mcpOutputForCapek } from '@/adapters/capek/mcp-output';

test('large MCP screenshots survive the installed Capek output policy without base64 text', async () => {
  const process = await createProcessScope([]);
  const plugin = toolOutputPolicyPlugin('test.browser-output', tmpdir());
  const agent = await createAgentScope(process, [plugin]);
  try {
    const data = 'a'.repeat(100_000);
    const output = mcpOutputForCapek({ content: [
      { type: 'text', text: 'Screenshot captured' },
      { type: 'image', data, mimeType: 'image/png' },
    ] });
    // 1.1.1 exports the plugin but not its service key or service type.
    const policy = agent.require(plugin.provides![0]!) as {
      applyToolOutputPolicy(output: unknown, context: { sessionId: string; toolCallId: string; toolName: string }): Promise<unknown>;
    };
    const bounded = await policy.applyToolOutputPolicy(output, {
      sessionId: 'browser-test', toolCallId: 'screenshot', toolName: 'browser_screenshot',
    });
    expect(bounded).toEqual(output);
    expect(bounded).toMatchObject({ value: { content: [
      { type: 'text', text: 'Screenshot captured' },
      { type: 'text', text: '[Image: image/png]' },
    ] } });
    expect(await mcpModelOutput({ toolCallId: 'screenshot', input: {}, output: bounded })).toEqual({
      type: 'content', value: [
        { type: 'text', text: 'Screenshot captured' },
        { type: 'image-data', data, mediaType: 'image/png' },
      ],
    });
  } finally {
    await agent.dispose();
    await process.dispose();
  }
});

test('ordinary MCP results and artifact references retain their JSON output', async () => {
  const result = { content: [{ type: 'text', text: 'ok' }], isError: false };
  expect(mcpOutputForCapek(result)).toEqual(result);
  const artifact = { type: 'tool-output-artifact', artifactId: 'test', preview: 'ok' };
  expect(await mcpModelOutput({ toolCallId: 'call', input: {}, output: artifact })).toEqual({
    type: 'text', value: JSON.stringify(artifact),
  });
});
