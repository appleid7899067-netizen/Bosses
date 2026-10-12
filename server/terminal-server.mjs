import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import process from 'process';
import path from 'path';

const PORT = 8081;
const PROJECT_ROOT = process.cwd();

console.log('🖥️  กำลังเริ่ม Terminal Server...');
console.log('📂 โฟลเดอร์โปรเจกต์:', PROJECT_ROOT);

const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  console.log(`✅ Terminal Server ทำงานที่พอร์ต ${PORT}`);
  console.log('⚠️  ใช้ในเครื่องเท่านั้น — ห้ามเปิดสู่ภายนอก!');
});

wss.on('connection', (ws) => {
  console.log('🔗 มีการเชื่อมต่อจากหน้าเว็บ');

  // เปิด Bash shell
  const shell = spawn('bash', [], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      PS1: '\\[\\033[38;5;111m\\]\\w \\[\\033[0m\\]$ '
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // ส่งผลลัพธ์กลับไปยังหน้าเว็บ
  shell.stdout.on('data', (data) => {
    ws.send(data.toString());
  });

  shell.stderr.on('data', (data) => {
    ws.send(data.toString());
  });

  // รับคำสั่งจากหน้าเว็บ แล้วส่งไปรันที่ Bash
  ws.on('message', (message) => {
    if (shell.stdin.writable) {
      shell.stdin.write(message.toString());
    }
  });

  ws.on('close', () => {
    console.log('🔌 ปิดการเชื่อมต่อ');
    shell.kill();
  });

  shell.on('exit', () => {
    ws.close();
  });

  ws.send('\x1b[32m✅ เชื่อมต่อสำเร็จ!\x1b[0m\r\n');
  ws.send(`📂 โฟลเดอร์: ${PROJECT_ROOT}\r\n\r\n`);
});

wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ พอร์ต ${PORT} ถูกใช้งานอยู่แล้ว`);
    console.error(`   ปิดโปรเซสที่ใช้พอร์ตนี้ก่อน: lsof -i :${PORT}`);
  } else {
    console.error('❌ เกิดข้อผิดพลาด:', err.message);
  }
  process.exit(1);
});
