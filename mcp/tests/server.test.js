import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parseArgs, INSTRUCTIONS } from '../src/server.js';

const BIN = fileURLToPath(new URL('../bin/night-shift-mcp.js', import.meta.url));

test('parseArgs reads flags and env', () => {
  assert.equal(parseArgs([], {}).port, 7117);
  assert.equal(parseArgs([], { NIGHT_SHIFT_PORT: '9000' }).port, 9000);
  assert.equal(parseArgs(['--port', '8123'], {}).port, 8123);
  assert.equal(parseArgs(['--port=8124'], {}).port, 8124);
  assert.deepEqual(parseArgs(['--allow-origin', 'https://a.example', '--allow-origin=https://b.example'], {}).allowOrigins, ['https://a.example', 'https://b.example']);
  assert.throws(() => parseArgs(['--port', 'nope'], {}), /Port/);
  assert.throws(() => parseArgs(['--rm-rf'], {}), /Unknown option/);
});

test('the persona does not spoil solutions', () => {
  for (const spoiler of ['0x0117', '0x0FF0', '0x3C3C', 'zero, one, one, seven', 'NS-02']) assert.ok(!INSTRUCTIONS.includes(spoiler), spoiler);
});

test('stdio server: instructions, intern-only tools, in-character offline replies', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, '--port', '0'], stderr: 'pipe' });
  const client = new Client({ name: 'night-shift-test', version: '0.0.0' });
  await client.connect(transport);
  try {
    assert.match(client.getInstructions(), /intern #0118/);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['enter_key', 'inspect_puzzle', 'list_files', 'message_player', 'read_file', 'read_logs', 'read_messages', 'shift_left', 'shift_right', 'wait_for_player', 'whoami', 'xor']);
    assert.ok(!names.some((n) => /dispatch|hydrate|reset|undo/i.test(n)));
    const res = await client.callTool({ name: 'whoami', arguments: {} });
    assert.match(res.content[0].text, /NO CARRIER/);
    const bad = await client.callTool({ name: 'message_player', arguments: { text: 'x'.repeat(500) } });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
  }
});
