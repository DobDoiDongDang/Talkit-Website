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
    const categoryId = c.req.param('categoryId');

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
      .where(eq(posts.categoryId, Number(categoryId)))
      .orderBy(desc(posts.createdAt));

    return c.json(postslist);
  } catch (error) {
    console.error('Error fetching category posts:', error);
    return c.json({ error: 'Failed to fetch category posts' }, 500);
  }
});

// เพิ่มโพสต์ใหม่
homeRoute.post("/posts", async (c) => {
  try {
    const body = await c.req.json();

    // Validate request body
    if (!body || typeof body !== 'object') {
      return c.json({
        error: 'Invalid request body'
      }, 400);
    }

    const { title, text, categoryId, images, codes } = body;

    // Validate required fields
    if (!title || !categoryId) {
      return c.json({
        error: 'Missing required fields'
      }, 400);
    }

    const userCookie = getCookie(c, "user");
    const user = userCookie ? JSON.parse(userCookie) : null;

    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return await db.transaction(async (tx) => {
      // Create main post
      const [post] = await tx.insert(posts).values({
        userId: user.id,
        categoryId,
        title,
        text: text || ''
      }).returning();

      // Add images if present
      if (Array.isArray(images) && images.length > 0) {
        await tx.insert(post_picture).values(
          images.map(url => ({
            postId: post.id,
            url: url.toString()
          }))
        );
      }

      // Add codes if present
      if (Array.isArray(codes) && codes.length > 0) {
        await tx.insert(post_code).values(
          codes.map(code => ({
            postId: post.id,
            code: code.toString()
          }))
        );
      }

      return c.json({
        success: true,
        post
      });
    });
  } catch (error: string | any) {
    console.error('Post creation error:', error);
    return c.json({
      error: 'Failed to process request',
      details: error.message
    }, 500);
  }
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
