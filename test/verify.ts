import http from 'node:http';
import assert from 'node:assert';
import { NanoKVMMCPClient } from '../electron/mcp-client.ts';
import { LlamaClient } from '../electron/llm-client.ts';
import { ConfigStore } from '../electron/store.ts';

async function main() {
  console.log('=== 1. Verifying ConfigStore ===');
  const store = new ConfigStore();
  const cfg = store.getConfig();
  assert.ok(cfg.llama.baseUrl, 'llama baseUrl should be set');
  assert.strictEqual(cfg.nanokvm.insecureSkipVerify, true, 'Default insecureSkipVerify must be true');

  const updated = store.saveConfig({
    llama: { ...cfg.llama, baseUrl: 'http://192.168.1.100:8080', model: 'qwen2.5-coder' },
    nanokvm: { ...cfg.nanokvm, endpoint: 'https://192.168.1.123/api/mcp', apiKey: 'sec_key_xyz' },
  });
  assert.strictEqual(updated.llama.baseUrl, 'http://192.168.1.100:8080');
  assert.strictEqual(updated.nanokvm.apiKey, 'sec_key_xyz');
  console.log(' ConfigStore verification passed.');

  console.log('\n=== 2. Verifying LlamaClient with mock llama.cpp server ===');
  let receivedAuth = '';
  const server = http.createServer((req, res) => {
    receivedAuth = req.headers['authorization'] || '';
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'qwen2.5-coder-7b' }, { id: 'meta-llama-3.1' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      // Send mock SSE chunks
      res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":" NanoKVM!"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(9876, () => resolve()));

  const llamaClient = new LlamaClient();
  llamaClient.init('http://localhost:9876', 'test-api-key');

  const models = await llamaClient.getModels();
  assert.deepStrictEqual(models, ['qwen2.5-coder-7b', 'meta-llama-3.1']);
  console.log(' Model listing passed:', models);

  let fullReply = '';
  await new Promise<void>((resolve, reject) => {
    llamaClient.streamChat({
      history: [{ id: '1', role: 'user', content: 'Hello', timestamp: Date.now() }],
      systemPrompt: 'System prompt test',
      model: 'qwen2.5-coder-7b',
      temperature: 0.7,
      maxTokens: 50,
      onEvent: (event) => {
        if (event.type === 'token') {
          fullReply += event.token;
        } else if (event.type === 'done') {
          resolve();
        } else if (event.type === 'error') {
          reject(new Error(event.error));
        }
      },
    });
  });

  assert.strictEqual(fullReply, 'Hello NanoKVM!');
  console.log(' Chat stream verification passed:', fullReply);
  server.close();

  console.log('\n=== 3. Verifying NanoKVM MCP Client TLS Skip & Headers ===');
  const mcp = new NanoKVMMCPClient();
  assert.strictEqual(mcp.getConnected(), false);
  assert.deepStrictEqual(mcp.getCachedTools(), []);

  // Attempt connect with insecureSkipVerify=true
  await mcp.connect('https://127.0.0.1:54321/api/mcp', 'mcp-secret-key-abc', true);
  assert.strictEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', 'NODE_TLS_REJECT_UNAUTHORIZED must be "0" when insecureSkipVerify=true');
  console.log(' InsecureSkipVerify appropriately disabled TLS verification.');

  console.log('\n ALL CLIENT VERIFICATIONS PASSED SUCCESSFULLY!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
