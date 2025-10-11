import 'dotenv/config';
import { Hono } from "hono";
import { readFile } from "fs/promises";
import * as path from "path";
import { serveStatic } from "@hono/node-server/serve-static";

// เพิ่ม import ที่เกี่ยวข้องกับฐานข้อมูล
import { db } from '../db/index.js';
import { posts, post_code, post_picture, comments, comment_code, comment_picture, users } from '../db/schema.js';
import { eq } from "drizzle-orm";

const postRoute = new Hono();

postRoute.use(
  "/",
  serveStatic({
    root: path.join(process.cwd(), "src/pages"),
  })
);

async function loadPage(filename: string) {
  const filePath = path.join(process.cwd(), "src/pages", filename);
  return await readFile(filePath, "utf-8");
}

// ----------------------------------------------------
// 🔹 หน้า postpage
// ----------------------------------------------------

postRoute.get("/", async (c) => {
  return c.html(await loadPage("post.html"));
});

// ----------------------------------------------------
// 🔹 API: ดึงข้อมูลโพสต์และรายละเอียด (ดึงชื่อ user เจ้าของ post จาก users)
// ----------------------------------------------------
postRoute.get("/:postid", async (c) => {
  const postId = Number(c.req.param("postid"));
  if (!postId) return c.json({ error: "Invalid post id" }, 400);

  // ดึงโพสต์
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  });
  if (!post) return c.json({ error: "Post not found" }, 404);

  // ดึงชื่อ user เจ้าของโพสต์
  const user = await db.query.users.findFirst({
    where: eq(users.id, post.userId),
  });

  // ดึงโค้ดและรูปของโพสต์
  const codes = await db.select().from(post_code).where(eq(post_code.postId, postId));
  const pictures = await db.select().from(post_picture).where(eq(post_picture.postId, postId));

  // ดึงคอมเมนต์ทั้งหมดของโพสต์
  const commentList = await db.select().from(comments).where(eq(comments.postId, postId));

  // สำหรับแต่ละคอมเมนต์ ดึงชื่อ user, โค้ด, รูป
  const commentsWithDetail = await Promise.all(commentList.map(async (comment) => {
    const commentUser = await db.query.users.findFirst({
      where: eq(users.id, comment.userId),
    });
    const commentCodes = await db.select().from(comment_code).where(eq(comment_code.commentId, comment.id));
    const commentPictures = await db.select().from(comment_picture).where(eq(comment_picture.commentId, comment.id));
    return {
      ...comment,
      username: commentUser?.username ?? "Anon",
      codes: commentCodes,
      pictures: commentPictures,
    };
  }));

  // เพิ่ม username เจ้าของโพสต์ใน response
  const postWithUsername = {
    ...post,
    username: user?.username ?? "Anon"
  };

  return c.json({
    post: postWithUsername,
    codes,
    pictures,
    comments: commentsWithDetail,
  });
});

// เพิ่มคอมเมนต์ใหม่
postRoute.post("/comments", async (c) => {
  const body = await c.req.json();
  const user = (c as any).get("user");
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

export { postRoute };
