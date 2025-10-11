import { pgTable, serial, integer, text, timestamp, varchar, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * กำหนด Drizzle Schema สำหรับตาราง 'users' ใน PostgreSQL
 * ตารางนี้ใช้สำหรับจัดเก็บข้อมูลผู้ใช้ที่ล็อกอินผ่าน AWS Cognito หรือ IdP อื่นๆ
 */
export const users = pgTable('users', {
    // 1. Primary Key ภายใน (Internal ID)
    id: serial('id').primaryKey(),

    // 2. (ลบ Cognito Subject ออก)

    // 3. Email Address
    email: text('email')
        .notNull()
        .unique(),

    // 4. Username
    username: text('username')
        .notNull(),

    // 5. Role/Permission
    role: varchar('role', { length: 50 })
        .notNull()
        .default('student'),

    // 6. User Profile URL
    userProfile: text('user_profile'),

    // 7. Timestamps
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

// หมวดหมู่ (Category)
export const categories = pgTable('categories', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    createdBy: integer('created_by').notNull(), // user id ที่สร้างหมวดหมู่
    createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// โพสต์ (Post)
export const posts = pgTable('posts', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(), // ใครเป็นคนโพสต์ (FK -> users.id)
    categoryId: integer('category_id').notNull(), // FK -> categories.id
    title: text('title').notNull(), // เพิ่ม title
    text: text('text').notNull(),
    createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ตารางเก็บรูปของโพสต์ (หลายรูปต่อโพสต์)
export const post_picture = pgTable('post_picture', {
    id: serial('id').primaryKey(),
    postId: integer('post_id').notNull(), // FK -> posts.id
    url: text('url').notNull(), // เก็บ URL หรือ path ของรูป
    createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ตารางเก็บ code ของโพสต์ (หลาย code ต่อโพสต์)
export const post_code = pgTable('post_code', {
    id: serial('id').primaryKey(),
    postId: integer('post_id').notNull(), // FK -> posts.id
    code: text('code').notNull(),
    createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// คอมเมนต์ (Comment)
// ลบ field picture และ code ออกมาเป็นตารางแยกเพื่อรองรับหลายรายการต่อคอมเมนต์
export const comments = pgTable('comments', {
    id: serial('id').primaryKey(),
    postId: integer('post_id').notNull(), // FK -> posts.id
    userId: integer('user_id').notNull(), // ใครเป็นคน comment (FK -> users.id)
    text: text('text').notNull(),
    createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ตารางเก็บรูปของคอมเมนต์ (หลายรูปต่อคอมเมนต์)
export const comment_picture = pgTable('comment_picture', {
    id: serial('id').primaryKey(),
    commentId: integer('comment_id').notNull(), // FK -> comments.id
    url: text('url').notNull(), // เก็บ URL หรือ path ของรูป
    createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ตารางเก็บ code ของคอมเมนต์ (หลาย code ต่อคอมเมนต์)
export const comment_code = pgTable('comment_code', {
    id: serial('id').primaryKey(),
    commentId: integer('comment_id').notNull(), // FK -> comments.id
    code: text('code').notNull(),
    createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
