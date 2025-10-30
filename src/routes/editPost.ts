import 'dotenv/config';
import { Hono } from "hono";
import { readFile } from "fs/promises";
import * as path from "path";
import { getCookie } from "hono/cookie";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { posts, post_code, post_picture, users, comments, comment_picture, comment_code } from '../db/schema.js';
import { db } from "../db/index.js";
import { eq } from "drizzle-orm";

// S3 client
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
  },
});

const editPostRoute = new Hono();

async function loadPage(filename: string) {
  const filePath = path.join(process.cwd(), "src/pages", filename);
  return await readFile(filePath, "utf-8");
}

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

// Helper: normalize multipart files
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

// GET /edit_post - หน้าแก้ไขโพสต์
editPostRoute.get('/', async (c) => {
  return c.html(await loadPage("edit_post.html"));
});

// GET /edit_post/:id/owner - ตรวจสอบเจ้าของโพสต์
editPostRoute.get('/:id/owner', async (c) => {
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

// PUT /edit_post/:id - อัพเดทโพสต์
editPostRoute.put('/:id', async (c) => {
  try {
    const postId = parseInt(c.req.param("id"));
    const userCookie = getCookie(c, "user");
    const user = userCookie ? JSON.parse(userCookie) : null;
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const userId = user.id;

    const body = await c.req.parseBody({ all: true });
    const categoryId = Number((body.categoryId ?? "").toString());
    const title = (body.title ?? "").toString();
    const text = (body.text ?? "").toString();
    
    // **อ่านข้อมูลใหม่ - แยกชัดเจน**
    const keepImageIdsStr = (body.keepImageIds ?? "").toString();
    const deleteImageIdsStr = (body.deleteImageIds ?? "").toString();
    const newCodesStr = (body.newCodes ?? "").toString();
    const keepCodesStr = (body.keepCodes ?? "").toString();
    const deleteCodeIdsStr = (body.deleteCodeIds ?? "").toString();

    console.log('=== RECEIVED DATA ===');
    console.log('Keep Image IDs:', keepImageIdsStr);
    console.log('Delete Image IDs:', deleteImageIdsStr);
    console.log('New Codes:', newCodesStr);
    console.log('Keep Codes:', keepCodesStr);
    console.log('Delete Code IDs:', deleteCodeIdsStr);

    // Parse JSON data
    let keepImageIds: number[] = [];
    let deleteImageIds: number[] = [];
    let newCodes: string[] = [];
    let keepCodes: Array<{id: number, code: string}> = [];
    let deleteCodeIds: number[] = [];

    try {
      if (keepImageIdsStr && keepImageIdsStr !== '') {
        keepImageIds = JSON.parse(keepImageIdsStr);
      }
    } catch (e) {
      console.error('Error parsing keepImageIds:', e);
    }

    try {
      if (deleteImageIdsStr && deleteImageIdsStr !== '') {
        deleteImageIds = JSON.parse(deleteImageIdsStr);
      }
    } catch (e) {
      console.error('Error parsing deleteImageIds:', e);
    }

    try {
      if (newCodesStr && newCodesStr !== '') {
        newCodes = JSON.parse(newCodesStr);
      }
    } catch (e) {
      console.error('Error parsing newCodes:', e);
    }

    try {
      if (keepCodesStr && keepCodesStr !== '') {
        keepCodes = JSON.parse(keepCodesStr);
      }
    } catch (e) {
      console.error('Error parsing keepCodes:', e);
    }

    try {
      if (deleteCodeIdsStr && deleteCodeIdsStr !== '') {
        deleteCodeIds = JSON.parse(deleteCodeIdsStr);
      }
    } catch (e) {
      console.error('Error parsing deleteCodeIds:', e);
    }

    console.log('=== PARSED DATA ===');
    console.log('Keep Image IDs:', keepImageIds);
    console.log('Delete Image IDs:', deleteImageIds);
    console.log('New Codes:', newCodes);
    console.log('Keep Codes:', keepCodes);
    console.log('Delete Code IDs:', deleteCodeIds);

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

    // **จัดการรูปภาพ - ใช้ข้อมูลใหม่**
    
    // 1. ดึงรูปภาพเดิมทั้งหมด
    const currentPictures = await db.select().from(post_picture).where(eq(post_picture.postId, postId));
    console.log('Current pictures in DB:', currentPictures.map(p => ({ id: p.id, url: p.url })));
    
    // 2. ลบรูปที่อยู่ใน deleteImageIds
    let deletedImageCount = 0;
    for (const imageId of deleteImageIds) {
      const result = await db.delete(post_picture)
        .where(eq(post_picture.id, imageId))
        .returning({ id: post_picture.id });
      
      if (result.length > 0) {
        deletedImageCount++;
        console.log('Deleted image with ID:', imageId);
      }
    }
    
    // 3. เพิ่มรูปภาพใหม่
    const newImagesField = (body as any)["newImages"];
    const newImageFiles = await normalizeFiles(newImagesField);
    let addedImageCount = 0;
    
    for (const f of newImageFiles) {
      try {
        const url = await uploadToS3(f.data, userId, f.type);
        await db.insert(post_picture).values({ postId, url });
        addedImageCount++;
        console.log('Added new image');
      } catch (e) {
        console.error('Error uploading new image:', e);
      }
    }

    // **จัดการโค้ด - ใช้ข้อมูลใหม่**
    
    // 1. ดึงโค้ดเดิมทั้งหมด
    const currentCodes = await db.select().from(post_code).where(eq(post_code.postId, postId));
    console.log('Current codes in DB:', currentCodes.map(c => ({ id: c.id, code: c.code })));
    
    // 2. ลบโค้ดที่อยู่ใน deleteCodeIds
    let deletedCodeCount = 0;
    for (const codeId of deleteCodeIds) {
      const result = await db.delete(post_code)
        .where(eq(post_code.id, codeId))
        .returning({ id: post_code.id });
      
      if (result.length > 0) {
        deletedCodeCount++;
        console.log('Deleted code with ID:', codeId);
      }
    }
    
    // 3. อัพเดทโค้ดที่มีอยู่
    let updatedCodeCount = 0;
    for (const codeData of keepCodes) {
      if (codeData.code && codeData.code.trim()) {
        const result = await db.update(post_code)
          .set({ code: codeData.code.trim() })
          .where(eq(post_code.id, codeData.id))
          .returning({ id: post_code.id });
        
        if (result.length > 0) {
          updatedCodeCount++;
          console.log('Updated code with ID:', codeData.id);
        }
      }
    }
    
    // 4. เพิ่มโค้ดใหม่
    let addedCodeCount = 0;
    for (const code of newCodes) {
      if (code && code.trim()) {
        await db.insert(post_code).values({ postId, code: code.trim() });
        addedCodeCount++;
        console.log('Added new code:', code.substring(0, 50) + '...');
      }
    }

    const summary = {
      deletedImages: deletedImageCount,
      addedImages: addedImageCount,
      deletedCodes: deletedCodeCount,
      updatedCodes: updatedCodeCount,
      addedCodes: addedCodeCount
    };

    console.log('=== UPDATE SUMMARY ===');
    console.log(summary);

    return c.json({ 
      success: true, 
      message: 'อัพเดทโพสต์เรียบร้อยแล้ว',
      summary
    });
  } catch (error) {
    console.error('Error updating post:', error);
    return c.json({ error: 'เกิดข้อผิดพลาดในการอัพเดทโพสต์' }, 500);
  }
});

// DELETE /edit_post/:id - ลบโพสต์
editPostRoute.delete('/:id', async (c) => {
  try {
    const postId = parseInt(c.req.param("id"));
    const userCookie = getCookie(c, "user");
    const user = userCookie ? JSON.parse(userCookie) : null;
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const userId = user.id;

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

    // ลบข้อมูลที่เกี่ยวข้องทั้งหมด (cascade delete)
    await db.delete(post_picture).where(eq(post_picture.postId, postId));
    await db.delete(post_code).where(eq(post_code.postId, postId));
    
    // ลบ comments และ comment-related data
        const commentList = await db.select().from(comments).where(eq(comments.postId, postId));
        for (const comment of commentList) {
          await db.delete(comment_picture).where(eq(comment_picture.commentId, comment.id));
          await db.delete(comment_code).where(eq(comment_code.commentId, comment.id));
        }
        await db.delete(comments).where(eq(comments.postId, postId));
    
    await db.delete(posts).where(eq(posts.id, postId));

    return c.json({ success: true, message: 'ลบโพสต์เรียบร้อยแล้ว' });
  } catch (error) {
    console.error('Error deleting post:', error);
    return c.json({ error: 'เกิดข้อผิดพลาดในการลบโพสต์' }, 500);
  }
});

export { editPostRoute };