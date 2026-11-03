import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { JsonRpcClient } from '../lib/jsonrpc.mjs';

function harness({ onServerRequest } = {}) {
  const toClient = new PassThrough();
  const fromClient = new PassThrough();
  const notifications = [];
  const rl = createInterface({ input: fromClient, crlfDelay: Infinity });
  const lines = [];
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    const message = JSON.parse(text);
    lines.push(message);
  });
  const client = new JsonRpcClient({
    stdin: fromClient,
    stdout: toClient,
    onNotification: (method, params) => notifications.push({ method, params }),
    onServerRequest: onServerRequest ?? ((method) => ({ handled: method })),
  });
  const nextLine = () => new Promise((resolve) => {
    if (lines.length > 0) { resolve(lines.shift()); return; }
    const handler = (message) => resolve(message);
    const poll = setInterval(() => {
      if (lines.length > 0) {
        clearInterval(poll);
        resolve(lines.shift());
      }
    }, 5);
    poll.unref?.();
  });
  const writeToClient = (message) => toClient.write(JSON.stringify(message) + '\n');
  return { client, writeToClient, notifications, nextLine };
}

test('request resolves with the matching id and ignores notifications', async () => {
  const { client, writeToClient, notifications, nextLine } = harness();
  const pending = client.request('ping', { value: 1 }, { timeoutMs: 1000 });
  const sent = await nextLine();
  assert.equal(sent.method, 'ping');
  assert.equal(sent.params.value, 1);
  writeToClient({ id: sent.id, result: { pong: 1 } });
  writeToClient({ method: 'note', params: { value: 2 } });
  assert.deepEqual(await pending, { pong: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].method, 'note');
  client.close();
});

test('rpc error rejects with code and data', async () => {
  const { client, writeToClient, nextLine } = harness();
  const pending = client.request('boom', {}, { timeoutMs: 1000 });
  const sent = await nextLine();
  writeToClient({ id: sent.id, error: { code: -32600, message: 'nope' } });
  await assert.rejects(pending, (err) => err.code === -32600 && /nope/.test(err.message));
  client.close();
});

test('server request receives a result frame', async () => {
  const { client, writeToClient, nextLine } = harness();
  writeToClient({ id: 900, method: 'approval', params: { reason: 'x' } });
  const response = await nextLine();
  assert.equal(response.id, 900);
  assert.deepEqual(response.result, { handled: 'approval' });
  client.close();
});

test('timeout rejects with TIMEOUT', async () => {
  const { client } = harness();
  await assert.rejects(client.request('slow', {}, { timeoutMs: 30 }), (err) => err.code === 'TIMEOUT');
  client.close();
});

test('abort rejects with ABORTED and removes the pending request', async () => {
  const { client } = harness();
  const controller = new AbortController();
  const pending = client.request('slow', {}, { timeoutMs: 5000, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (err) => err.code === 'ABORTED');
  assert.equal(client.pending.size, 0);
  client.close();
});
