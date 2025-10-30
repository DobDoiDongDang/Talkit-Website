import 'dotenv/config';
import { Hono } from "hono";
import { readFile } from "fs/promises";
import * as path from "path";
import { db } from '../db/index.js';
import { categories, posts, comments, post_picture, post_code, users } from '../db/schema.js'; // เพิ่ม users
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

// ✅ Helper function สำหรับเช็ค admin - ดึงจาก database
async function isAdmin(userId: number): Promise<boolean> {
  try {
    if (!userId) return false;
    
    console.log('Checking admin status for user ID:', userId);
    
    // ดึงข้อมูล user จาก database (ไม่เลือกฟิลด์ที่ไม่มีอยู่ใน schema)
    const user = await db.select({
      id: users.id,
      username: users.username,
      role: users.role
    }).from(users).where(eq(users.id, userId)).limit(1);
    
    if (user.length === 0) {
      console.log('User not found in database');
      return false;
    }
    
    const userData = user[0];
    console.log('User data from DB:', userData);
    
    // เช็คสถานะ admin จากฟิลด์ที่มี (role, username, id)
    const adminStatus = (
      userData.role === 'admin' ||
      userData.username === 'admin' ||
      userData.id === 1 // hardcode admin ID
    );
    
    console.log('Admin status result:', adminStatus);
    return adminStatus;
    
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

// ----------------------------------------------------
// 🔹 หน้า homepage
// ----------------------------------------------------

// ✅ [แก้ไข] API เช็คสถานะ admin - ใช้ฟังก์ชันใหม่
homeRoute.get("/admin/check", async (c) => {
  try {
    const userCookie = getCookie(c, "user");
    const user = userCookie ? JSON.parse(userCookie) : null;
    
    if (!user || !user.id) {
      return c.json({ isAdmin: false, user: null });
    }
    
    const adminStatus = await isAdmin(user.id);
    
    return c.json({ 
      isAdmin: adminStatus,
      user: { id: user.id, username: user.username }
    });
  } catch (error) {
    console.error('Error checking admin status:', error);
    return c.json({ isAdmin: false, user: null });
  }
});

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
  
  // เช็คว่ามีหมวดหมู่นี้แล้วหรือไม่
  const existing = await db.select().from(categories).where(eq(categories.name, body.name));
  if (existing.length > 0) {
    return c.json({ error: 'มีหมวดหมู่นี้อยู่แล้ว' }, 400);
  }
  
  const inserted = await db.insert(categories).values({
    name: body.name,
    createdBy: user.id,
  }).returning();
  return c.json(inserted[0]);
});

// ✅ [แก้ไข] API แก้ไขหมวดหมู่ (เฉพาะ admin)
homeRoute.put("/categories/:id", async (c) => {
  try {
    const categoryId = parseInt(c.req.param("id"));
    const { name } = await c.req.json();
    
    const userCookie = getCookie(c, "user");
    const user = userCookie ? JSON.parse(userCookie) : null;
    
    if (!user || !(await isAdmin(user.id))) {
      return c.json({ error: 'ไม่มีสิทธิ์ในการแก้ไขหมวดหมู่' }, 403);
    }
    
    if (!name || !name.trim()) {
      return c.json({ error: 'กรุณาระบุชื่อหมวดหมู่' }, 400);
    }
    
    // เช็คว่ามีหมวดหมู่ชื่อนี้แล้วหรือไม่ (ยกเว้นตัวเอง)
    const existing = await db.select().from(categories)
      .where(eq(categories.name, name.trim()));
    
    if (existing.length > 0 && existing[0].id !== categoryId) {
      return c.json({ error: 'มีหมวดหมู่ชื่อนี้อยู่แล้ว' }, 400);
    }
    
    const updated = await db.update(categories)
      .set({ name: name.trim() })
      .where(eq(categories.id, categoryId))
      .returning();
    
    if (updated.length === 0) {
      return c.json({ error: 'ไม่พบหมวดหมู่ที่ต้องการแก้ไข' }, 404);
    }
    
    return c.json({ success: true, category: updated[0] });
  } catch (error) {
    console.error('Error updating category:', error);
    return c.json({ error: 'เกิดข้อผิดพลาดในการแก้ไขหมวดหมู่' }, 500);
  }
});

// ✅ [แก้ไข] API ลบหมวดหมู่ (เฉพาะ admin)
homeRoute.delete("/categories/:id", async (c) => {
  try {
    const categoryId = parseInt(c.req.param("id"));
    
    const userCookie = getCookie(c, "user");
    const user = userCookie ? JSON.parse(userCookie) : null;
    
    if (!user || !(await isAdmin(user.id))) {
      return c.json({ error: 'ไม่มีสิทธิ์ในการลบหมวดหมู่' }, 403);
    }
    
    // เช็คว่ามีหมวดหมู่นี้จริงหรือไม่
    const category = await db.select().from(categories).where(eq(categories.id, categoryId));
    if (category.length === 0) {
      return c.json({ error: 'ไม่พบหมวดหมู่ที่ต้องการลบ' }, 404);
    }
    
    console.log(`Admin ${user.username} is deleting category: ${category[0].name} (ID: ${categoryId})`);
    
    // ดึงโพสต์ทั้งหมดในหมวดหมู่นี้
    const postsInCategory = await db.select({ id: posts.id }).from(posts).where(eq(posts.categoryId, categoryId));
    const postIds = postsInCategory.map(p => p.id);
    
    console.log(`Found ${postIds.length} posts to delete`);
    
    let deletedItems = {
      comments: 0,
      pictures: 0,
      codes: 0,
      posts: 0,
      category: 0
    };
    
    // ลบข้อมูลที่เกี่ยวข้องทั้งหมด (ตามลำดับ)
    if (postIds.length > 0) {
      // 1. ลบคอมเมนต์ทั้งหมดในโพสต์เหล่านี้
      for (const postId of postIds) {
        const deletedComments = await db.delete(comments).where(eq(comments.postId, postId)).returning();
        deletedItems.comments += deletedComments.length;
      }
      
      // 2. ลบรูปภาพทั้งหมดในโพสต์เหล่านี้
      for (const postId of postIds) {
        const deletedPictures = await db.delete(post_picture).where(eq(post_picture.postId, postId)).returning();
        deletedItems.pictures += deletedPictures.length;
      }
      
      // 3. ลบโค้ดทั้งหมดในโพสต์เหล่านี้
      for (const postId of postIds) {
        const deletedCodes = await db.delete(post_code).where(eq(post_code.postId, postId)).returning();
        deletedItems.codes += deletedCodes.length;
      }
      
      // 4. ลบโพสต์ทั้งหมด
      const deletedPosts = await db.delete(posts).where(eq(posts.categoryId, categoryId)).returning();
      deletedItems.posts = deletedPosts.length;
    }
    
    // 5. ลบหมวดหมู่
    const deletedCategory = await db.delete(categories).where(eq(categories.id, categoryId)).returning();
    deletedItems.category = deletedCategory.length;
    
    console.log('Deletion summary:', deletedItems);
    
    return c.json({ 
      success: true, 
      message: `ลบหมวดหมู่ "${category[0].name}" และข้อมูลที่เกี่ยวข้องเรียบร้อยแล้ว`,
      deletedItems
    });
  } catch (error) {
    console.error('Error deleting category:', error);
    return c.json({ error: 'เกิดข้อผิดพลาดในการลบหมวดหมู่' }, 500);
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

// หน้า post (render) ให้เปิดได้ด้วย /post?id=...
homeRoute.get("/post", async (c) => {
  return c.html(await loadPage("post.html"));
});

// ✅ [เพิ่ม] หน้า edit_post (render)
homeRoute.get("/edit_post", async (c) => {
  return c.html(await loadPage("edit_post.html"));
});

export { homeRoute };