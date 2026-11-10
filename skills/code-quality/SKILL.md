# Code Quality

## Trigger
ใช้เมื่อผู้ใช้ขอรีวิวโค้ด แก้บั๊ก ตรวจ typecheck/lint/test หรือประเมินความเสี่ยงของระบบ

## Workflow
1. ระบุขอบเขตและจุดที่ตรวจจริง
2. ตรวจ correctness, security, error handling, performance และ maintainability
3. ให้ findings ตามความรุนแรง พร้อมไฟล์/บรรทัดและผลกระทบ
4. แก้แบบเล็กที่สุดที่ปลอดภัย
5. รัน typecheck, build, lint และ test ที่เกี่ยวข้อง

## Guardrails
- ห้ามอ้างว่าทดสอบผ่านหากยังไม่ได้รันจริง
- ห้ามแก้ secrets หรือปิด security check เพื่อให้ CI ผ่าน
- การเปลี่ยน behavior สำคัญต้องมี test หรือคำอธิบายผลกระทบ
