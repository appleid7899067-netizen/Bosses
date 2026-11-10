# Web App Testing

## Trigger
ใช้เมื่อทดสอบหน้าเว็บ interaction, routing, forms, responsive behavior หรือ runtime errors

## Workflow
1. เปิดแอปและรอให้ JavaScript พร้อม
2. ตรวจ DOM และ screenshot ก่อน action
3. ใช้ selectors ที่สื่อความหมาย
4. ทดสอบ happy path และ failure path
5. ตรวจ console/page errors และ mobile viewport
6. บันทึกผลที่ตรวจจริง

## Guardrails
- ใช้ browser automation กับแอปที่อยู่ในขอบเขตเท่านั้น
- ห้ามส่ง credentials จริงเข้า form หรือบันทึกลง screenshot/log
- ห้ามถือว่า HTTP 200 แปลว่า UI ใช้งานได้
