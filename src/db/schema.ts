import { pgTable, serial, text, timestamp, varchar, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * กำหนด Drizzle Schema สำหรับตาราง 'users' ใน PostgreSQL
 * ตารางนี้ใช้สำหรับจัดเก็บข้อมูลผู้ใช้ที่ล็อกอินผ่าน AWS Cognito หรือ IdP อื่นๆ
 */
export const users = pgTable('users', {
    // 1. Primary Key ภายใน (Internal ID)
    id: serial('id').primaryKey(),

    // 2. Cognito Subject (Identity Provider ID)
    // *** แก้ไข: ย้าย .comment() มาอยู่ตำแหน่งที่ถูกต้อง ***
    cognitoSub: uuid('cognito_sub')
        .notNull()
        .unique(),

    // 3. Email Address
    email: text('email')
        .notNull()
        .unique(),

    // 4. Display Name
    displayName: text('username')
        .notNull(),

    // 5. Role/Permission
    role: varchar('role', { length: 50 })
        .notNull()
        .default('student'),

    // 6. Timestamps
    createdAt: timestamp('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
        
    updatedAt: timestamp('updated_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`) 
        .$onUpdate(() => new Date()),

}, (table) => {
    // กำหนด Index เพิ่มเติมเพื่อความเร็วในการค้นหาด้วย Email
    return {
        emailIndex: uniqueIndex('email_idx').on(table.email),
    };
});
