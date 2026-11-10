export async function processMessageWithTools(userMessage: string) {
  const normalized = userMessage.trim().toLowerCase();
  const requestedTool = normalized.includes("ไฟล์") || normalized.includes("ls")
    ? "list_files"
    : normalized.includes("รัน")
      ? "run_command"
      : normalized.includes("อ่าน")
        ? "read_file"
        : null;

  if (!requestedTool) {
    return {
      reply: "บอทหน้านี้ยังไม่เปิดใช้เครื่องมือระบบจริง จึงไม่รันคำสั่งหรืออ่านไฟล์แทนผู้ใช้",
      toolUsed: false,
      toolResult: null,
    };
  }

  return {
    reply: `เครื่องมือ ${requestedTool} ยังไม่พร้อมใช้งานจริง จึงไม่ได้รันคำสั่งหรืออ่านไฟล์ใด ๆ`,
    toolUsed: false,
    toolResult: null,
  };
}
