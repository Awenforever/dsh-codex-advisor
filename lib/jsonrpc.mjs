/**
 * Minimal newline-delimited JSON-RPC 2.0 client for the Codex app-server.
 *
 * The app-server does not use the `jsonrpc: "2.0"` field on the wire; frames
 * are `{id, method, params}` / `{id, result}` / `{id, error}` and notifications.
 */
import { createInterface } from 'node:readline';

export class JsonRpcError extends Error {
  constructor(message, { code = null, data = null } = {}) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
    this.data = data;
  }
}

export class JsonRpcClient {
  constructor({ stdin, stdout, onNotification, onServerRequest, onLog } = {}) {
    if (!stdin || !stdout) throw new Error('JsonRpcClient requires stdin and stdout');
    this.stdin = stdin;
    this.stdout = stdout;
    this.onNotification = onNotification ?? (() => {});
    this.onServerRequest = onServerRequest ?? (() => ({}));
    this.onLog = onLog ?? (() => {});
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.rl = createInterface({ input: stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => this.handleLine(line));
    this.rl.on('close', () => this.failAll(new JsonRpcError('json-rpc stream closed', { code: 'STREAM_CLOSED' })));
    stdout.on?.('error', (err) => this.failAll(err));
  }

  request(method, params, { timeoutMs = 60000, signal } = {}) {
    if (this.closed) {
      return Promise.reject(new JsonRpcError('json-rpc client is closed', { code: 'CLOSED' }));
    }
    const id = this.nextId++;
    const message = { id, method };
    if (params !== undefined) message.params = params;

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
        this.pending.delete(id);
        fn(value);
      };
      const onAbort = () => finish(reject, new JsonRpcError(`${method} aborted`, { code: 'ABORTED' }));

      if (signal?.aborted) {
        onAbort();
        return;
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => {
          finish(reject, new JsonRpcError(`${method} timed out after ${timeoutMs}ms`, { code: 'TIMEOUT' }));
        }, timeoutMs);
        timer.unref?.();
      }
      this.pending.set(id, {
        resolve: (value) => finish(resolve, value),
        reject: (err) => finish(reject, err),
      });
      try {
        this.write(message);
      } catch (err) {
        finish(reject, err);
      }
    });
  }

  notify(method, params) {
    const message = { method };
    if (params !== undefined) message.params = params;
    this.write(message);
  }

  write(message) {
    if (this.closed) throw new JsonRpcError('json-rpc client is closed', { code: 'CLOSED' });
    this.stdin.write(JSON.stringify(message) + '\n');
  }

  handleLine(line) {
    const text = typeof line === 'string' ? line.trim() : '';
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      this.onLog('warn', { event: 'json-rpc-non-json-line', line: text.slice(0, 400) });
      return;
    }
    if (message.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.onLog('debug', { event: 'json-rpc-orphan-response', id: message.id });
        return;
      }
      if (message.error) {
        pending.reject(new JsonRpcError(message.error.message ?? 'rpc error', {
          code: message.error.code ?? null,
          data: message.error.data ?? null,
        }));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.id !== undefined && message.method) {
      let result;
      let error;
      try {
        result = this.onServerRequest(message.method, message.params) ?? {};
      } catch (err) {
        error = { code: -32603, message: err?.message ?? 'server request failed' };
      }
      try {
        this.write(error ? { id: message.id, error } : { id: message.id, result });
      } catch (err) {
        this.onLog('warn', { event: 'json-rpc-server-request-reply-failed', method: message.method, message: err?.message });
      }
      return;
    }
    if (message.method) {
      try {
        this.onNotification(message.method, message.params);
      } catch (err) {
        this.onLog('warn', { event: 'json-rpc-notification-failed', method: message.method, message: err?.message });
      }
    }
  }

  failAll(err) {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(err);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.rl.close(); } catch { /* ignore */ }
    this.failAll(new JsonRpcError('json-rpc client closed', { code: 'CLOSED' }));
  }
}
