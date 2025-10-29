import 'dotenv/config';
import { Hono } from "hono";
import { readFile } from "fs/promises";
import * as path from "path";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie } from "hono/cookie";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { categories, posts, post_code, post_picture, comments, comment_code, comment_picture, users } from '../db/schema.js';
import { db } from "../db/index.js";
import { eq, desc } from "drizzle-orm";

// S3 client (reuse if you already created it elsewhere)
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    // include only if you actually use temporary creds
    ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
  },
});

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

// Helper: normalize multipart “images” to an array and extract Buffer
async function normalizeFiles(imagesField: any): Promise<Array<{ data: Buffer | Uint8Array, type: string }>> {
  const list = !imagesField ? [] : Array.isArray(imagesField) ? imagesField : [imagesField];
  const out: Array<{ data: Buffer | Uint8Array, type: string }> = [];
  for (const f of list) {
    if (!f) continue;
    const type = (f as any).type || "application/octet-stream";

    if (typeof (f as any).arrayBuffer === "function") {
      const ab = await (f as any).arrayBuffer();
      out.push({ data: Buffer.from(ab), type });
    } else if ((f as any).data) {
      out.push({ data: (f as any).data as Buffer | Uint8Array, type });
    }
  }
  return out;
}

// Create post (POST /post)
// Note: You can POST FormData to /post with fields: title, text, categoryId, codes (multi), images[] (multi)
postRoute.post("/", async (c) => {
  try {
    // Parse multipart body; “all: true” keeps repeated keys as arrays
    const body = await c.req.parseBody({ all: true });

    // Support both images[] and images
    const imagesField = (body as any)["images[]"] ?? (body as any)["images"];
    const files = await normalizeFiles(imagesField);

    const title = (body.title ?? "").toString();
    const text = (body.text ?? "").toString();
    const categoryIdNum = Number((body.categoryId ?? "").toString());

    if (!categoryIdNum || Number.isNaN(categoryIdNum)) {
      return c.json({ error: "Invalid categoryId" }, 400);
    }

    // codes can be string or string[]
    const codesRaw = (body as any).codes;
    const codes: string[] = !codesRaw ? [] : Array.isArray(codesRaw) ? codesRaw.map(String) : [String(codesRaw)];

    const userCookie = getCookie(c, "user");
    const user = userCookie ? JSON.parse(userCookie) : null;
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    // Create post and upload images
    return await db.transaction(async (tx) => {
      const [post] = await tx.insert(posts).values({
        userId: user.id,
        categoryId: categoryIdNum,
        title,
        text: text || "",
      }).returning();

      for (const f of files) {
        const url = await uploadToS3(f.data, user.id, f.type);
        await tx.insert(post_picture).values({ postId: post.id, url });
      }

      if (codes.length) {
        await tx.insert(post_code).values(codes.map((code) => ({ postId: post.id, code })));
      }

      return c.json({ success: true, postId: post.id, uploaded: files.length });
    });
  } catch (err: any) {
    console.error("Create post error:", err);
    return c.json({ error: "Failed to create post", details: err?.message }, 500);
  }
});

async function uploadToS3(
  buffer: ArrayBuffer | Uint8Array | Buffer,
  userId: number,
  mimetype: string
) {
  const imageId = uuidv4();
  const ext = (mimetype?.split("/")?.[1] || "jpg").toLowerCase();
  const key = `post/${userId}/${imageId}.${ext}`;
  const body = Buffer.isBuffer(buffer) || buffer instanceof Uint8Array ? buffer : Buffer.from(buffer);

  await s3.send(new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: key,
    Body: body,
    ContentType: mimetype || "application/octet-stream",
    ACL: "public-read",
  }));

  return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

// Add BEFORE the "/:postid" route to avoid param conflicts

// GET /posts/me - include username & userProfile
postRoute.get("/me", async (c) => {
  try {
    const userCookie = getCookie(c, "user");
    const user = userCookie ? JSON.parse(userCookie) : null;
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const postslist = await db
      .select({
        id: posts.id,
        title: posts.title,
        text: posts.text,
        userId: posts.userId,
        categoryId: posts.categoryId,
        categoryName: categories.name,
        createdAt: posts.createdAt,
        username: users.username,
        userProfile: users.userProfile,
      })
      .from(posts)
      .leftJoin(categories, eq(posts.categoryId, categories.id))
      .leftJoin(users, eq(posts.userId, users.id))
      .where(eq(posts.userId, user.id))
      .orderBy(desc(posts.createdAt));
    return c.json(postslist);
  } catch (error) {
    console.error("Error fetching user posts:", error);
    return c.json({ error: "Failed to fetch user posts" }, 500);
  }
});

// GET /posts/category/:categoryId - include username & userProfile
postRoute.get("/category/:categoryId", async (c) => {
  try {
    const categoryId = Number(c.req.param("categoryId"));
    if (!categoryId) {
      return c.json({ error: "Category ID is required" }, 400);
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
        username: users.username,
        userProfile: users.userProfile,
      })
      .from(posts)
      .leftJoin(categories, eq(posts.categoryId, categories.id))
      .leftJoin(users, eq(posts.userId, users.id))
      .where(eq(posts.categoryId, categoryId))
      .orderBy(desc(posts.createdAt));

    return c.json(postslist);
  } catch (error) {
    console.error("Error fetching category posts:", error);
    return c.json({ error: "Failed to fetch category posts" }, 500);
  }
});

postRoute.get("/:postid", async (c) => {
  const postId = Number(c.req.param("postid"));
  if (!postId) return c.json({ error: "Invalid post id" }, 400);

  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) return c.json({ error: "Post not found" }, 404);

  const user = await db.query.users.findFirst({ where: eq(users.id, post.userId) });

  const codes = await db.select().from(post_code).where(eq(post_code.postId, postId));
  const pictures = await db.select().from(post_picture).where(eq(post_picture.postId, postId));

  const commentList = await db.select().from(comments).where(eq(comments.postId, postId));

  const commentsWithDetail = await Promise.all(commentList.map(async (comment) => {
    const commentUser = await db.query.users.findFirst({ where: eq(users.id, comment.userId) });
    const commentCodes = await db.select().from(comment_code).where(eq(comment_code.commentId, comment.id));
    const commentPictures = await db.select().from(comment_picture).where(eq(comment_picture.commentId, comment.id));
    return {
      ...comment,
      username: commentUser?.username ?? "Anon",
      userProfile: (commentUser as any)?.userProfile ?? null,
      codes: commentCodes,
      pictures: commentPictures,
    };
  }));

  const postWithUser = {
    ...post,
    username: user?.username ?? "Anon",
    userProfile: (user as any)?.userProfile ?? null,
  };

  return c.json({
    post: postWithUser,
    codes,
    pictures,
    comments: commentsWithDetail,
  });
});

// GET route สำหรับหน้าแก้ไข
postRoute.get('/edit_post', async (c) => {
  return c.html(await loadPage("edit_post.html"));
});

 // PUT route สำหรับอัพเดทโพสต์
postRoute.put('/posts/:id', async (c) => {
  try {
    const postId = parseInt(c.req.param("id"));
    const userId = Number(c.req.header("userId")); // get userId from request headers
    if (!userId || Number.isNaN(userId)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Parse multipart or plain fields
    const body = await c.req.parseBody({ all: true });

    const categoryId = Number((body.categoryId ?? "").toString());
    const title = (body.title ?? "").toString();
    const text = (body.text ?? "").toString();
    const existingImages = (body as any).existingImages;
    const existingCodes = (body as any).existingCodes;
    const codesRaw = (body as any).codes;

    // ตรวจสอบว่าเป็นเจ้าของโพสต์หรือไม่
    const ownerRecord = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      columns: { userId: true },
    });

    if (!ownerRecord) {
      return c.json({ error: 'ไม่พบโพสต์' }, 404);
    }

    if (ownerRecord.userId !== userId) {
      return c.json({ error: 'ไม่มีสิทธิ์แก้ไขโพสต์นี้' }, 403);
    }

    // อัพเดทโพสต์
        await db.update(posts).set({
          categoryId: Number.isNaN(categoryId) ? undefined : categoryId,
          title,
          text,
        }).where(eq(posts.id, postId));

    // ลบรูปภาพและโค้ดเก่าทั้งหมด (recreate from provided existing lists)
    await db.delete(post_picture).where(eq(post_picture.postId, postId));
    await db.delete(post_code).where(eq(post_code.postId, postId));

    // เพิ่มรูปภาพที่เหลืออยู่ (existingImages expected as JSON strings)
    if (existingImages) {
      const existingImagesArray = Array.isArray(existingImages) ? existingImages : [existingImages];
      for (const imgStr of existingImagesArray) {
        try {
          const img = JSON.parse(imgStr);
          await db.insert(post_picture).values({
            postId,
            url: img.url ?? null,
          });
        } catch (e) {
          console.error('Error parsing existing image:', e);
        }
      }
    }

    // เพิ่มรูปภาพใหม่ (multipart images[] or images)
    const imagesField = (body as any)["images[]"] ?? (body as any)["images"];
    const newFiles = await normalizeFiles(imagesField);
    for (const f of newFiles) {
      try {
        const url = await uploadToS3(f.data, userId, f.type);
        await db.insert(post_picture).values({ postId, url });
      } catch (e) {
        console.error('Error uploading new image:', e);
      }
    }

    // เพิ่มโค้ดที่เหลืออยู่ (existingCodes expected as JSON strings)
    if (existingCodes) {
      const existingCodesArray = Array.isArray(existingCodes) ? existingCodes : [existingCodes];
      for (const codeStr of existingCodesArray) {
        try {
          const code = JSON.parse(codeStr);
          if (code.code && code.code.trim()) {
            await db.insert(post_code).values({ postId, code: code.code });
          }
        } catch (e) {
          console.error('Error parsing existing code:', e);
        }
      }
    }

    // เพิ่มโค้ดใหม่
    if (codesRaw) {
      const codesArray = Array.isArray(codesRaw) ? codesRaw : [codesRaw];
      for (const code of codesArray) {
        if (code && code.trim()) {
          await db.insert(post_code).values({ postId, code });
        }
      }
    }

    return c.json({ success: true, message: 'อัพเดทโพสต์เรียบร้อยแล้ว' });
  } catch (error) {
    console.error('Error updating post:', error);
    return c.json({ error: 'เกิดข้อผิดพลาดในการอัพเดทโพสต์' }, 500);
  }
});

postRoute.delete('/posts/:id', async (c) => {
  try {
    const postId = parseInt(c.req.param("id"));
    const userId = Number(c.req.header("userId")); // get userId from request headers
    if (!userId || Number.isNaN(userId)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // ตรวจสอบว่าเป็นเจ้าของโพสต์หรือไม่
    const ownerRecord = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      columns: { userId: true },
    });

    if (!ownerRecord) {
      return c.json({ error: 'ไม่พบโพสต์' }, 404);
    }

    if (ownerRecord.userId !== userId) {
      return c.json({ error: 'ไม่มีสิทธิ์ลบโพสต์นี้' }, 403);
    }

    // ลบข้อมูลที่เกี่ยวข้องทั้งหมด
    await db.delete(post_picture).where(eq(post_picture.postId, postId));
    await db.delete(post_code).where(eq(post_code.postId, postId));
    await db.delete(comments).where(eq(comments.postId, postId));
    await db.delete(posts).where(eq(posts.id, postId));

    return c.json({ success: true, message: 'ลบโพสต์เรียบร้อยแล้ว' });
  } catch (error) {
    console.error('Error deleting post:', error);
    return c.json({ error: 'เกิดข้อผิดพลาดในการลบโพสต์' }, 500);
  }
});

postRoute.get('/posts/:id/owner', async (c) => {
  try {
    const postId = parseInt(c.req.param("id"));
    const userCookie = getCookie(c, "user");
    const user = userCookie ? JSON.parse(userCookie) : null;
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const userId = user.id;

    const rows = await db.select({
      userId: posts.userId,
      username: users.username,
    }).from(posts).leftJoin(users, eq(posts.userId, users.id)).where(eq(posts.id, postId));

    if (!rows || rows.length === 0) {
      return c.json({ error: 'ไม่พบโพสต์' }, 404);
    }

    const post = rows[0];

    return c.json({
      isOwner: post.userId === userId,
      postUserId: post.userId,
      postUsername: post.username
    });
  } catch (error) {
    console.error('Error checking post owner:', error);
    return c.json({ error: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์' }, 500);
  }
});

export { postRoute };
