import { defineConfig } from 'drizzle-kit';

/**
 * ไฟล์กำหนดค่าสำหรับ Drizzle ORM CLI
 * ใช้สำหรับรันคำสั่ง 'drizzle-kit' เช่น generate, push, studio
 */
export default defineConfig({
  // กำหนดชนิดของฐานข้อมูลที่เราใช้งาน
  schema: './src/db/schema.ts', // ที่อยู่ของไฟล์ Drizzle Schema
  out: './drizzle', // โฟลเดอร์ที่ใช้เก็บไฟล์ Migration
  dialect: 'postgresql', // กำหนดเป็น PostgreSQL

  // กำหนดตัวแปรสภาพแวดล้อมสำหรับเชื่อมต่อฐานข้อมูล
  dbCredentials: {
    // Drizzle CLI จะอ่าน ENV เหล่านี้เพื่อเชื่อมต่อฐานข้อมูล
    url: process.env.DATABASE_URL!, 
  },
  
  // ปิดการใช้ SSL หากไม่จำเป็น เพื่อหลีกเลี่ยงข้อผิดพลาดในการเชื่อมต่อ (อาจต้องปรับตามสภาพแวดล้อมจริง)
  strict: true,
  verbose: true,
});
