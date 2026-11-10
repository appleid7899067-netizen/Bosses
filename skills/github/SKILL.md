# GitHub

## Trigger
ใช้เมื่อผู้ใช้ขออ่าน repository, branch, commit, issue, PR, Actions หรือแก้ไฟล์บน GitHub

## Workflow
- อ่านสถานะและไฟล์ที่เกี่ยวข้องก่อน
- ใช้ repository allowlist และตรวจสิทธิ์ของผู้เรียกทุกครั้ง
- งานเขียนให้ใช้ branch/PR เป็นค่าเริ่มต้น
- ใช้ current file SHA เพื่อป้องกันเขียนทับการเปลี่ยนแปลงของผู้อื่น
- รายงาน commit/PR URL และผล CI ตามจริง

## Security
- ห้ามส่ง token/private key ไปยัง client, prompt, log หรือ URL
- ห้ามเรียก repository ที่ไม่ได้รับอนุญาต
- GitHub write operations ต้องผ่าน server-side authorization และ explicit enablement
- ห้ามใช้ user-supplied owner/repo เพื่อขยายสิทธิ์โดยไม่มี allowlist
