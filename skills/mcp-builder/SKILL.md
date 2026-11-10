# MCP Builder

## Trigger
ใช้เมื่อผู้ใช้ขอสร้างหรือปรับ MCP server, tool, resource หรือ prompt

## Workflow
1. ออกแบบชื่อ tool และ input schema ให้ชัดเจน
2. validate input ด้วย schema และจำกัดขนาด/จำนวน
3. แยก read กับ write permissions
4. เพิ่ม authentication, authorization, rate limit และ timeout
5. ไม่เปิด endpoint ภายนอกโดย default
6. เขียน unit/integration tests สำหรับ success และ failure paths

## Guardrails
- ห้ามสร้าง tool ที่ bypass authentication
- ห้ามรัน shell หรือ arbitrary code ใน process ของ web app
- External endpoint ต้องเป็น HTTPS และอยู่ใน allowlist
- Error response ต้องไม่เปิดเผย secrets หรือข้อมูลภายใน
