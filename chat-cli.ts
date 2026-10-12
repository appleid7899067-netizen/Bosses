#!/usr/bin/env node
import readline from 'node:readline';
import { stdin, stdout } from 'node:process';

const rl = readline.createInterface({
  input: stdin,
  output: stdout,
  prompt: '💬 Bosses > '
});

console.log('🚀 Bosses Chat CLI พร้อมใช้งาน');
console.log('📌 พิมพ์: ช่วย, สถานะ, โครงสร้าง, ออก\n');

rl.prompt();

rl.on('line', (input) => {
  const text = input.trim();
  const cmd = text.toLowerCase();

  if (!text) {
    rl.prompt();
    return;
  }

  if (cmd === 'ออก' || cmd === 'exit' || cmd === 'quit') {
    console.log('👋 ลาก่อน! 💜');
    rl.close();
    return;
  }

  if (cmd === 'ช่วย' || cmd === 'help') {
    console.log(`
📋 คำสั่งที่ใช้ได้:
  ช่วย          แสดงคำสั่งทั้งหมด
  สถานะ         เช็คสถานะระบบ
  โครงสร้าง      ดูโครงสร้างโปรเจกต์
  ออก / exit    ปิดโปรแกรม
`);
    rl.prompt();
    return;
  }

  if (cmd === 'สถานะ' || cmd === 'status') {
    console.log('✅ ระบบทำงานปกติ');
    console.log('📂 โปรเจกต์: Bosses');
    console.log('⏳ เวลา:', new Date().toLocaleString('th-TH'));
    rl.prompt();
    return;
  }

  if (cmd === 'โครงสร้าง') {
    console.log('\n🏗️  โครงสร้างโปรเจกต์:');
    console.log('  📁 src/components/');
    console.log('  📁 src/routes/');
    console.log('  📁 src/lib/');
    console.log('  📁 server/middleware/\n');
    rl.prompt();
    return;
  }

  console.log('🤖 ได้รับ:', text);
  console.log('💡 พิมพ์ "ช่วย" ดูคำสั่งทั้งหมด\n');
  rl.prompt();
});

rl.on('close', () => {
  process.exit(0);
});
