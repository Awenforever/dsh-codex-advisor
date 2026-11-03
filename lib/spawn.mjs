/**
 * Adapter for the Node child_process module, shaped like the DSH
 * `ctx.subprocess.spawn` handle. Used by tests and by profiles that do not
 * expose the subprocess service.
 */
import { spawn } from 'node:child_process';

export function nodeSpawn() {
  return (spec) => {
    const [command, ...args] = spec.argv;
    if (!command) throw new Error('nodeSpawn requires argv[0]');
    const child = spawn(command, args, {
      cwd: spec.cwd,
      env: spec.env ?? process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolveDone(value);
    };
    child.once('exit', (exitCode, signal) => settle({ exitCode, signal }));
    child.once('error', (error) => settle({ exitCode: null, signal: null, error }));
    return {
      pid: child.pid ?? null,
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      done,
      terminate: () => {
        try { child.kill(); } catch { /* ignore */ }
      },
      waitForExit: async () => {
        if (settled) return true;
        await Promise.race([
          done,
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve(null), spec.graceMs ?? 3000);
            timer.unref?.();
          }),
        ]);
        return settled;
      },
    };
  };
}
