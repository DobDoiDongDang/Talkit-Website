import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { Pool } from 'pg';
import 'dotenv/config'; // โหลดตัวแปรจาก .env

/**
 * ฟังก์ชันสำหรับเริ่มต้น Drizzle Database Client
 * ใช้เพื่อรัน Query ในแอปพลิเคชันของเรา
 */

// ตรวจสอบว่ามีการกำหนด DATABASE_URL ใน environment variable หรือไม่
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set in environment variables');
}

// 1. สร้าง Pool Connection จาก pg driver
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ตั้งค่า SSL หากใช้ฐานข้อมูลบน Cloud เช่น AWS RDS
  // ssl: true, 
});

// 2. สร้าง Drizzle Client โดยผูกกับ Connection Pool และ Schema
export const db = drizzle(pool, {
  schema, // นำเข้า schema ทั้งหมดจาก ./schema.ts
  logger: true, // เปิดใช้งานการ Log SQL Query
});

// หากคุณต้องการเรียกใช้ Query:
// await db.select().from(schema.users).limit(1);
