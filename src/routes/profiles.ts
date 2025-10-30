import 'dotenv/config';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

export const profilesRoute = new Hono();

// S3 client (local to this route)
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
  },
});

async function uploadAvatarToS3(
  buffer: ArrayBuffer | Uint8Array | Buffer,
  userId: number,
  mimetype: string
) {
  const id = uuidv4();
  const ext = (mimetype?.split('/')?.[1] || 'jpg').toLowerCase();
  const key = `avatar/${userId}/${id}.${ext}`;
  const body = Buffer.isBuffer(buffer) || buffer instanceof Uint8Array ? buffer : Buffer.from(buffer);

  await s3.send(new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: key,
    Body: body,
    ContentType: mimetype || 'application/octet-stream',
    ACL: 'public-read',
  }));

  return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

// GET /profiles/me -> current profile
profilesRoute.get('/me', async (c) => {
  const userCookie = getCookie(c, 'user');
  const u = userCookie ? JSON.parse(userCookie) : null;
  if (!u) return c.json({ error: 'Unauthorized' }, 401);

  const row = await db.query.users.findFirst({ where: eq(users.id, u.id) });
  if (!row) return c.json({ error: 'User not found' }, 404);
  console.log('Fetched user profile:', row.userProfile);
  return c.json({
    id: row.id,
    username: row.username,
    email: row.email,
    userProfile: row.userProfile ?? null,
  });
});

// POST /profiles/me -> update username and/or avatar
profilesRoute.post('/me', async (c) => {
  const body = await c.req.parseBody({ all: true });

  const userCookie = getCookie(c, 'user');
  const u = userCookie ? JSON.parse(userCookie) : null;
  if (!u) return c.json({ error: 'Unauthorized' }, 401);

  const newUsername = (body.username ?? '').toString().trim() || undefined;

  const avatarField = (body as any)['avatar'];
  let uploadedUrl: string | undefined;
  if (avatarField) {
    const type = (avatarField as any).type || 'application/octet-stream';
    let buf: Buffer | Uint8Array | null = null;
    if (typeof (avatarField as any).arrayBuffer === 'function') {
      const ab = await (avatarField as any).arrayBuffer();
      buf = Buffer.from(ab);
    } else if ((avatarField as any).data) {
      buf = (avatarField as any).data as Buffer | Uint8Array;
    }
    if (buf) {
      uploadedUrl = await uploadAvatarToS3(buf, u.id, type);
    }
  }

  const updates: any = {};
  if (newUsername) updates.username = newUsername;
  if (uploadedUrl) updates.userProfile = uploadedUrl;

  if (Object.keys(updates).length === 0) {
    const current = await db.query.users.findFirst({ where: eq(users.id, u.id) });
    return c.json({
      id: current?.id, username: current?.username, email: current?.email,
      userProfile: (current as any)?.userProfile ?? null
    });
  }

  const [updated] = await db.update(users).set(updates).where(eq(users.id, u.id)).returning();

  const refreshed = {
    id: updated.id,
    username: updated.username,
    email: updated.email,
    userProfile: (updated as any).userProfile ?? uploadedUrl ?? null,
  };
  setCookie(c, 'user', JSON.stringify(refreshed), {
    httpOnly: false, secure: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60,
  });

  return c.json({ success: true, user: refreshed });
});