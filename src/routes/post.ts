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

export { postRoute };
