import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { eq, inArray, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { comments, comment_picture, comment_code, users } from '../db/schema.js';

// [add] S3 uploader (local)
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
  },
});

async function uploadCommentImageToS3(
  buffer: ArrayBuffer | Uint8Array | Buffer,
  userId: number,
  mimetype: string
) {
  try {
    const id = uuidv4();
    const ext = (mimetype?.split('/')?.[1] || 'jpg').toLowerCase();
    const key = `comment/${userId}/${id}.${ext}`;

    const body = Buffer.isBuffer(buffer)
      ? buffer
      : buffer instanceof Uint8Array
      ? buffer
      : Buffer.from(buffer);

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET!,
        Key: key,
        Body: body,
        ContentType: mimetype || 'application/octet-stream',
        ACL: 'public-read',
      })
    );

    return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  } catch (err) {
    console.error('S3 upload error (comment):', err);
    throw err;
  }
}

export const commentRoute = new Hono();

// POST /posts/comments  -> add comment with text, images[], codes[]
commentRoute.post('/comments', async (c) => {
  try {
    const body = await c.req.parseBody({ all: true });

    const userCookie = getCookie(c, 'user');
    const user = userCookie ? JSON.parse(userCookie) : null;
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    console.log(body)
    const postId = Number((body.postId ?? '').toString());
    const text = (body.text ?? '').toString();
    if (!postId || Number.isNaN(postId)) {
      return c.json({ error: 'Invalid postId' }, 400);
    }

    const codesRaw = (body as any)['codes[]'] ?? (body as any)['codes'];
    const codeList: string[] = !codesRaw ? [] : Array.isArray(codesRaw) ? codesRaw.map(String) : [String(codesRaw)];

    const imagesField = (body as any)['images[]'] ?? (body as any)['images'];
    const filesIn = !imagesField ? [] : Array.isArray(imagesField) ? imagesField : [imagesField];
    const files: Array<{ buf: Buffer | Uint8Array; type: string }> = [];
    for (const f of filesIn) {
      if (!f) continue;
      const type = (f as any).type || 'application/octet-stream';
      if (typeof (f as any).arrayBuffer === 'function') {
        const ab = await (f as any).arrayBuffer();
        files.push({ buf: Buffer.from(ab), type });
      } else if ((f as any).data) {
        files.push({ buf: (f as any).data as Buffer | Uint8Array, type });
      }
    }

    return await db.transaction(async (tx) => {
      const [comment] = await tx
        .insert(comments)
        .values({ postId, userId: user.id, text })
        .returning();

      for (const f of files) {
        const url = await uploadCommentImageToS3(f.buf, user.id, f.type);
        await tx.insert(comment_picture).values({ commentId: comment.id, url });
      }

      if (codeList.length) {
        await tx.insert(comment_code).values(codeList.map((code) => ({ commentId: comment.id, code })));
      }

      return c.json({ success: true, commentId: comment.id, images: files.length, codes: codeList.length });
    });
  } catch (err: any) {
    console.error('Create comment error:', err);
    return c.json({ error: 'Failed to create comment', details: err?.message }, 500);
  }
});

// GET /posts/:postId/comments -> include userProfile
commentRoute.get('/:postId/comments', async (c) => {
  try {
    const postId = Number(c.req.param('postId'));
    if (!postId) return c.json({ error: 'Invalid postId' }, 400);

    const rows = await db
      .select({
        id: comments.id,
        postId: comments.postId,
        userId: comments.userId,
        text: comments.text,
        createdAt: comments.createdAt,
        username: users.username,
        userProfile: users.userProfile,
      })
      .from(comments)
      .leftJoin(users, eq(comments.userId, users.id))
      .where(eq(comments.postId, postId))
      .orderBy(desc(comments.createdAt));

    const ids = rows.map((r) => r.id);
    const pics = ids.length
      ? await db.select().from(comment_picture).where(inArray(comment_picture.commentId, ids))
      : [];
    const codes = ids.length
      ? await db.select().from(comment_code).where(inArray(comment_code.commentId, ids))
      : [];

    const picturesByCmt = new Map<number, any[]>();
    const codesByCmt = new Map<number, any[]>();
    for (const p of pics) {
      const arr = picturesByCmt.get(p.commentId) ?? [];
      arr.push({ id: p.id, url: p.url });
      picturesByCmt.set(p.commentId, arr);
    }
    for (const k of codes) {
      const arr = codesByCmt.get(k.commentId) ?? [];
      arr.push({ id: k.id, code: k.code, language: (k as any).language || 'Code' });
      codesByCmt.set(k.commentId, arr);
    }

    const data = rows.map((r) => ({
      id: r.id,
      postId: r.postId,
      userId: r.userId,
      username: r.username,
      userProfile: r.userProfile ?? null,
      text: r.text,
      createdAt: r.createdAt,
      pictures: picturesByCmt.get(r.id) ?? [],
      codes: codesByCmt.get(r.id) ?? [],
    }));

    return c.json(data);
  } catch (err: any) {
    console.error('Get comments error:', err);
    return c.json({ error: 'Failed to fetch comments', details: err?.message }, 500);
  }
});