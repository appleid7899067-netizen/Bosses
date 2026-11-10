import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import process from 'process';

const TOKEN = process.env.LOCAL_TERMINAL_TOKEN;
if (process.env.ENABLE_LOCAL_TERMINAL !== "true" || !TOKEN) {
  console.error("Local terminal is disabled. Set ENABLE_LOCAL_TERMINAL=true and LOCAL_TERMINAL_TOKEN to enable it.");
  process.exit(0);
}

const wss = new WebSocketServer({
  port: 8081,
  host: "127.0.0.1",
  verifyClient: ({ req }) => new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("token") === TOKEN,
});

console.log('🖥️  Terminal Server กำลังทำงานที่พอร์ต 8081...');

wss.on('connection', (ws) => {
  console.log('✅ มีการเชื่อมต่อเข้ามา');

  const shell = spawn('bash', [], {
    cwd: process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  shell.stdout.on('data', (data) => {
    ws.send(data.toString());
  });

  shell.stderr.on('data', (data) => {
    ws.send(data.toString());
  });

  /** @param {Buffer|string} message */
  ws.on('message', (message) => {
    shell.stdin.write(message);
  });

  ws.on('close', () => {
    shell.kill();
  });

  shell.on('exit', () => {
    ws.close();
  });
});
