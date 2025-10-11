import 'dotenv/config';
import { Hono } from "hono";
import { readFile } from "fs/promises";
import * as path from "path";
import { db } from '../db/index.js';
import { categories, posts, comments } from '../db/schema.js';
import { eq } from "drizzle-orm";

// ✅ [แก้] import serveStatic จาก path ใหม่
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie } from "hono/cookie";

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
  const user = c.get("user");
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const result = await db.select().from(posts).where(eq(posts.userId, user.id));
  return c.json(result);
});

// เพิ่มโพสต์ใหม่
homeRoute.post("/posts", async (c) => {
  const body = await c.req.json();
  const user = c.get("user");
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  // include required fields (e.g. userId) and cast to any to avoid strict schema mismatch
  const inserted = await db.insert(posts).values({
    text: body.text,
    title: body.title,
    picture: body.picture ?? null,
    code: body.code ?? null,
    userId: user.id,
    // Add other required fields from the posts schema if needed
  } as any).returning();
  return c.json(inserted[0]);
});

// ดึงคอมเมนต์ของโพสต์
homeRoute.get("/comments/:postId", async (c) => {
  const postId = Number(c.req.param('postId'));
  const result = await db.select().from(comments).where(eq(comments.postId, postId));
  return c.json(result);
});

// เพิ่มคอมเมนต์ใหม่
homeRoute.post("/comments", async (c) => {
  const body = await c.req.json();
  const user = c.get("user");
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const inserted = await db.insert(comments).values({
    postId: body.postId,
    userId: user.id,
    categoryId: body.categoryId,
    text: body.text,
    picture: body.picture ?? null,
    code: body.code ?? null,
  } as any).returning();
  return c.json(inserted[0]);
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
