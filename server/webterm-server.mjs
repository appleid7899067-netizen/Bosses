import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import process from 'process';

const wss = new WebSocketServer({ port: 8081 });

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
