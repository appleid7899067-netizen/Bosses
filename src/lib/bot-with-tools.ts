import { getTool } from './tools';

export async function processMessageWithTools(userMessage: string) {
  console.log(`💬 ผู้ใช้: ${userMessage}`);
  
  let botReply = '';
  let toolResult = null;

  if (userMessage.includes('ไฟล์') || userMessage.includes('ls')) {
    const tool = getTool('list_files');
    if (tool) {
      toolResult = await tool.execute({ folder: '.' });
      botReply = `✅ เรียกใช้เครื่องมือ: list_files\n\n${toolResult}\n\nนี่คือรายการไฟล์ในโปรเจกต์ครับ!`;
    }
  } else if (userMessage.includes('รัน')) {
    const tool = getTool('run_command');
    if (tool) {
      toolResult = await tool.execute({ command: userMessage.replace('รัน', '').trim() });
      botReply = `⚡ เรียกใช้เครื่องมือ: run_command\n\n${toolResult}`;
    }
  } else if (userMessage.includes('อ่าน')) {
    const tool = getTool('read_file');
    if (tool) {
      toolResult = await tool.execute({ path: 'src/routes/bot.tsx' });
      botReply = `📂 เรียกใช้เครื่องมือ: read_file\n\n${toolResult}`;
    }
  } else {
    botReply = `ได้ครับ! 🛠️\n\nผมช่วยได้:\n- 📁 พิมพ์ "ดูไฟล์"\n- ⚡ พิมพ์ "รัน ls"\n- 📂 พิมพ์ "อ่านไฟล์"\n\nลองพิมพ์ดูสิครับ! ✨`;
  }

  return {
    reply: botReply,
    toolUsed: toolResult ? true : false,
    toolResult,
  };
}
