import 'dotenv/config';
import { Hono } from "hono";
import { readFile } from "fs/promises";
import * as path from "path";
import { db } from '../db/index.js';
import { categories, posts, comments, post_code, post_picture } from '../db/schema.js';
import { eq, desc } from "drizzle-orm";

// ✅ [แก้] import serveStatic จาก path ใหม่
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie } from "hono/cookie";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    sessionToken: process.env.AWS_SESSION_TOKEN!,
  },
});

export async function postImageUpload(buffer: ArrayBuffer | Uint8Array | Buffer, userId: number, mimetype: string) {
  const imageId = uuidv4();
  const ext = mimetype.split("/")[1] || "jpg";
  const key = `post/${userId}/${imageId}.${ext}`;

  // Ensure Body is a Buffer/Uint8Array (types accepted by PutObjectCommand)
  const body = Buffer.isBuffer(buffer) || buffer instanceof Uint8Array ? buffer : Buffer.from(buffer);
  console.log(body)
  await s3.send(new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: key,
    Body: body,
    ContentType: mimetype,
    ACL: "public-read"
  }));

  return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

type Variables = {
  user?: {
    id: number;
    // add other user properties if needed
  };
};

const homeRoute = new Hono<{ Variables: Variables }>();

// ✅ [เพิ่ม] เสิร์ฟไฟล์ static (เช่น auth-style.css) จาก src/pages
homeRoute.use(
  "/",
  serveStatic({
    root: path.join(process.cwd(), "src/pages"),
  })
);

// ✅ Utility สำหรับโหลดหน้า HTML
async function loadPage(filename: string) {
  const filePath = path.join(process.cwd(), "src/pages", filename);
  return await readFile(filePath, "utf-8");
}

// ----------------------------------------------------
// 🔹 หน้า homepage
// ----------------------------------------------------


// ดึงหมวดหมู่ทั้งหมด
homeRoute.get("/categories", async (c) => {
  const result = await db.select().from(categories);
  return c.json(result);
});

// เพิ่มหมวดหมู่ใหม่
homeRoute.post("/categories", async (c) => {
  const body = await c.req.json();
  // ต้องการ user id จาก session หรือ token
  const userCookie = getCookie(c, "user");
  const user = userCookie ? JSON.parse(userCookie) : null;
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const inserted = await db.insert(categories).values({
    name: body.name,
    createdBy: user.id,
  }).returning();
  return c.json(inserted[0]);
});

// ดึงโพสต์ของ user
homeRoute.get("/posts/me", async (c) => {
  try {
    const userCookie = getCookie(c, "user");
    const user = userCookie ? JSON.parse(userCookie) : null;

    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const postslist = await db
      .select({
        id: posts.id,
        title: posts.title,
        text: posts.text,
        userId: posts.userId,
        categoryId: posts.categoryId,
        categoryName: categories.name,  // Add category name
        createdAt: posts.createdAt,
      })
      .from(posts)
      .leftJoin(categories, eq(posts.categoryId, categories.id))  // Join with categories
      .where(eq(posts.userId, user.id))
      .orderBy(desc(posts.createdAt));

    return c.json(postslist);
  } catch (error) {
    console.error('Error fetching user posts:', error);
    return c.json({ error: 'Failed to fetch user posts' }, 500);
  }
});


// ดึงโพสต์ตามหมวดหมู่
homeRoute.get("/posts/:categoryId", async (c) => {
  try {
    const categoryId = parseInt(c.req.param('categoryId'));
    if (!categoryId) {
      return c.json({ error: 'Category ID is required' }, 400);
    }

    const postslist = await db
      .select({
        id: posts.id,
        title: posts.title,
        text: posts.text,
        userId: posts.userId,
        categoryId: posts.categoryId,
        categoryName: categories.name,
        createdAt: posts.createdAt,
      })
      .from(posts)
      .leftJoin(categories, eq(posts.categoryId, categories.id))
      .where(eq(posts.categoryId, categoryId))
      .orderBy(desc(posts.createdAt));
    return c.json(postslist);
  } catch (error) {
    console.error('Error fetching category posts:', error);
    return c.json({ error: 'Failed to fetch category posts' }, 500);
  }
});

const upload = multer();

// เพิ่มโพสต์ใหม่ (รองรับ multipart/form-data)
homeRoute.post("/posts", async (c: any) => {
  try {
    const body = await c.req.parseBody({ all: true });
    let files = body['images'];
    console.log(files);

    const { title, text, categoryId } = body;
    const categoryIdNum = Number(categoryId);
    if (!categoryId || isNaN(categoryIdNum)) {
      return c.json({ error: "Invalid categoryId" }, 400);
    }

    let codes = body.codes;

    // กรณี codes ส่งมาหลายอัน จะเป็น array, ถ้ามีอันเดียวจะเป็น string
    if (codes && !Array.isArray(codes)) {
      codes = [codes];
    }

    const userCookie = getCookie(c, "user");
    const user = userCookie ? JSON.parse(userCookie) : null;
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    return await db.transaction(async (tx) => {
      // 1. สร้างโพสต์
      const [post] = await tx.insert(posts).values({
        userId: user.id,
        categoryId: categoryIdNum,
        title,
        text: text || ''
      }).returning();

      // 2. อัปโหลดรูปไป S3 และบันทึก url
      if (files) {
        files.forEach(async (file: File) => {
          const buffer = await file.arrayBuffer();
          const url = await postImageUpload(buffer, user.id, file.type);
          await tx.insert(post_picture).values({
            postId: post.id,
            url,
          });
        });
      }

      // 3. เพิ่ม code blocks
      if (codes && Array.isArray(codes)) {
        await tx.insert(post_code).values(
          codes.map((code: string) => ({
            postId: post.id,
            code: code.toString()
          }))
        );
      }

      return c.json({ success: true, post });
    });
  } catch (error: any) {
    console.error('Post creation error:', error);
    return c.json({
      error: 'Failed to process request',
      details: error.message
    }, 500);
  }
});

// หน้า homepage (render)
homeRoute.get("/", async (c) => {
  return c.html(await loadPage("homepage.html"));
});

// หน้า createpost (render)
homeRoute.get("/createpost", async (c) => {
  return c.html(await loadPage("create_post.html"));
});

// หน้า profile (render)
homeRoute.get("/profile", async (c) => {
  return c.html(await loadPage("profile.html"));
});

export { homeRoute };