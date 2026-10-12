export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (params: any) => Promise<any>;
}

export const tools: Tool[] = [
  {
    name: 'read_file',
    description: 'อ่านเนื้อหาไฟล์ในโปรเจกต์',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'ที่อยู่ไฟล์ เช่น src/routes/bot.tsx' },
      },
      required: ['path'],
    },
    execute: async ({ path }) => {
      return `📂 อ่านไฟล์: ${path}\n(เนื้อหาไฟล์จะปรากฏที่นี่)`;
    },
  },
  {
    name: 'list_files',
    description: 'ดูรายการไฟล์ในโฟลเดอร์',
    parameters: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'โฟลเดอร์ที่ต้องการดู' },
      },
    },
    execute: async ({ folder = '.' }) => {
      return `📁 รายการไฟล์ใน: ${folder}\n- src/\n- public/\n- server/\n- package.json`;
    },
  },
  {
    name: 'run_command',
    description: 'รันคำสั่งในเทอร์มินัล',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'คำสั่งที่ต้องการรัน' },
      },
      required: ['command'],
    },
    execute: async ({ command }) => {
      return `⚡ กำลังรัน: ${command}\n(ผลลัพธ์คำสั่งจะปรากฏที่นี่)`;
    },
  },
  {
    name: 'search_web',
    description: 'ค้นหาข้อมูลจากอินเทอร์เน็ต',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'คำที่ต้องการค้นหา' },
      },
      required: ['query'],
    },
    execute: async ({ query }) => {
      return `🌐 ผลการค้นหา: "${query}"\n(ผลลัพธ์จากเว็บจะปรากฏที่นี่)`;
    },
  },
];

export function getTool(name: string): Tool | undefined {
  return tools.find(t => t.name === name);
}

export function getToolsSchema() {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
