import 'dotenv/config';
import { Hono } from "hono";
import { readFile } from "fs/promises";
import * as path from "path";
import { db } from '../db/index.js';
import { categories } from '../db/schema.js';

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

// หน้า post (render) ให้เปิดได้ด้วย /post?id=...
homeRoute.get("/post", async (c) => {
  return c.html(await loadPage("post.html"));
});

export { homeRoute };