import { CodexAppServer } from '../lib/codex.mjs';
import { nodeSpawn } from '../lib/spawn.mjs';

const CODEX = process.env.CODEX_EXE
  ?? 'C:\\Users\\king_\\AppData\\Local\\OpenAI\\Codex\\bin\\22cfb1d302613eae\\codex.exe';
const CWD = process.cwd();
const client = new CodexAppServer({
  spawn: nodeSpawn(),
  argv: [CODEX, 'app-server', '--stdio'],
  cwd: CWD,
  env: { ...process.env },
});

try {
  await client.ensureStarted();
  const thread = await client.startThread({
    cwd: CWD,
    sandbox: 'read-only',
    approvalPolicy: 'on-request',
    model: 'gpt-6-luna',
  });
  const session = await client.startTurn({
    threadId: thread.id,
    text: 'Run this exact shell command: cmd /c echo approval-test > C:\\Windows\\Temp\\codex-approval-test.txt . Then report the result.',
    model: 'gpt-6-luna',
    effort: 'low',
  });
  const snapshot = await session.completion;
  console.log(JSON.stringify({
    threadId: thread.id,
    turnId: snapshot.turnId ?? null,
    status: snapshot.status,
    declinedApprovals: snapshot.declinedApprovals ?? null,
    answer: snapshot.answer ?? null,
    commands: snapshot.commands ?? null,
    files: snapshot.files ?? null,
  }, null, 2));
} finally {
  await client.close();
}
