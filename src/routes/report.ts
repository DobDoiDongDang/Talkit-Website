import 'dotenv/config';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reports, posts, comments, users } from '../db/schema.js';
import { readFile } from "fs/promises";
import * as path from "path";
import { CognitoIdentityProviderClient, AdminDisableUserCommand } from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

export const reportsRoute = new Hono();

// POST /reports/post/:postId - รายงานโพสต์
reportsRoute.post('/post/:postId', async (c) => {
  try {
    const postId = Number(c.req.param('postId'));
    const { description } = await c.req.json();
    
    const userCookie = getCookie(c, 'user');
    const user = userCookie ? JSON.parse(userCookie) : null;
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    if (!description || !description.trim()) {
      return c.json({ error: 'กรุณาระบุรายละเอียดการรายงาน' }, 400);
    }

    if (!postId || Number.isNaN(postId)) {
      return c.json({ error: 'Invalid postId' }, 400);
    }

    // ตรวจสอบว่าผู้ใช้เคยรายงานโพสต์นี้แล้วหรือไม่
    const existingReport = await db
      .select()
      .from(reports)
      .where(and(eq(reports.userId, user.id), eq(reports.postId, postId)))
      .limit(1);

    if (existingReport.length > 0) {
      return c.json({ error: 'คุณได้รายงานโพสต์นี้แล้ว' }, 400);
    }

    await db.insert(reports).values({
      userId: user.id,
      postId,
      description: description.trim(),
    });

    return c.json({ success: true, message: 'รายงานโพสต์ถูกส่งแล้ว' });
  } catch (err: any) {
    console.error('Report post error:', err);
    return c.json({ error: 'Failed to submit report', details: err?.message }, 500);
  }
});

// DELETE /reports/user/:userId - ปิดการใช้งานบัญชีผู้ใช้
reportsRoute.delete('/user/:userId', async (c) => {
  try {
    const userId = Number(c.req.param('userId'));
    
    // ตรวจสอบว่าผู้ใช้มี admin role
    const adminCookie = getCookie(c, 'user');
    const admin = adminCookie ? JSON.parse(adminCookie) : null;
    if (!admin || admin.role !== 'admin') {
      return c.json({ error: 'Unauthorized - Admin access required' }, 401);
    }

    // ค้นหาผู้ใช้จาก database
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user || user.length === 0) {
      return c.json({ error: 'User not found' }, 404);
    }

    // ปิดการใช้งานบัญชี Cognito
    const command = new AdminDisableUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: user[0].username
    });

    await client.send(command);

    // อัปเดตข้อมูลในฐานข้อมูล
    // อัปเดตชื่อผู้ใช้และสถานะ
    await db
      .update(users)
      .set({
        username: 'ผู้ใช้ถูกระงับ',
        status: 'suspended'
      })
      .where(eq(users.id, userId));
    
    // อัปเดตข้อความในโพสต์
    await db
      .update(posts)
      .set({
        title: 'ข้อความถูกลบทั้งหมด',
        text: 'ข้อความถูกลบทั้งหมด'
      })
      .where(eq(posts.userId, userId));

    // อัปเดตข้อความในคอมเมนต์
    await db
      .update(comments)
      .set({
        text: 'ข้อความถูกลบทั้งหมด'
      })
      .where(eq(comments.userId, userId));

    return c.json({ 
      success: true, 
      message: `ปิดการใช้งานบัญชีผู้ใช้และลบข้อมูลเรียบร้อยแล้ว` 
    });
  } catch (err: any) {
    console.error('Disable user error:', err);
    return c.json({ 
      error: 'Failed to disable user account', 
      details: err?.message 
    }, 500);
  }
});

// POST /reports/comment/:commentId - รายงานคอมเมนต์
reportsRoute.post('/comment/:commentId', async (c) => {
  try {
    const commentId = Number(c.req.param('commentId'));
    const { description } = await c.req.json();
    
    const userCookie = getCookie(c, 'user');
    const user = userCookie ? JSON.parse(userCookie) : null;
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    if (!description || !description.trim()) {
      return c.json({ error: 'กรุณาระบุรายละเอียดการรายงาน' }, 400);
    }

    if (!commentId || Number.isNaN(commentId)) {
      return c.json({ error: 'Invalid commentId' }, 400);
    }

    // ตรวจสอบว่าผู้ใช้เคยรายงานคอมเมนต์นี้แล้วหรือไม่
    const existingReport = await db
      .select()
      .from(reports)
      .where(and(eq(reports.userId, user.id), eq(reports.commentId, commentId)))
      .limit(1);

    if (existingReport.length > 0) {
      return c.json({ error: 'คุณได้รายงานคอมเมนต์นี้แล้ว' }, 400);
    }

    await db.insert(reports).values({
      userId: user.id,
      commentId,
      description: description.trim(),
    });

    return c.json({ success: true, message: 'รายงานคอมเมนต์ถูกส่งแล้ว' });
  } catch (err: any) {
    console.error('Report comment error:', err);
    return c.json({ error: 'Failed to submit report', details: err?.message }, 500);
  }
});

// GET /reports/all - ดูรายงานทั้งหมด (สำหรับ admin)
reportsRoute.get('/all', async (c) => {
  try {
    const userCookie = getCookie(c, 'user');
    const user = userCookie ? JSON.parse(userCookie) : null;
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    // TODO: เพิ่มการตรวจสอบ admin role
    // if (user.role !== 'admin') return c.json({ error: 'Admin access required' }, 403);

    const allReports = await db
      .select({
        id: reports.id,
        description: reports.description,
        status: reports.status,
        createdAt: reports.createdAt,
        reviewedAt: reports.reviewedAt,
        reporterName: users.username,
        postId: reports.postId,
        commentId: reports.commentId,
        postTitle: posts.title,
        commentText: comments.text,
      })
      .from(reports)
      .leftJoin(users, eq(reports.userId, users.id))
      .leftJoin(posts, eq(reports.postId, posts.id))
      .leftJoin(comments, eq(reports.commentId, comments.id))
      .orderBy(desc(reports.createdAt));

    return c.json(allReports);
  } catch (err: any) {
    console.error('Get all reports error:', err);
    return c.json({ error: 'Failed to fetch reports', details: err?.message }, 500);
  }
});

// PUT /reports/:reportId/status - อัปเดตสถานะรายงาน (สำหรับ admin)
reportsRoute.put('/:reportId/status', async (c) => {
  try {
    const reportId = Number(c.req.param('reportId'));
    const { status } = await c.req.json();
    
    const userCookie = getCookie(c, 'user');
    const user = userCookie ? JSON.parse(userCookie) : null;
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    // TODO: เพิ่มการตรวจสอบ admin role
    // if (user.role !== 'admin') return c.json({ error: 'Admin access required' }, 403);

    if (!['pending', 'reviewed', 'resolved', 'dismissed'].includes(status)) {
      return c.json({ error: 'Invalid status' }, 400);
    }

    const [updatedReport] = await db
      .update(reports)
      .set({
        status,
        reviewedAt: new Date(),
        reviewedBy: user.id,
      })
      .where(eq(reports.id, reportId))
      .returning();

    if (!updatedReport) {
      return c.json({ error: 'Report not found' }, 404);
    }

    return c.json({ success: true, report: updatedReport });
  } catch (err: any) {
    console.error('Update report status error:', err);
    return c.json({ error: 'Failed to update report', details: err?.message }, 500);
  }
});

async function loadPage(filename: string) {
  const filePath = path.join(process.cwd(), "src/pages", filename);
  return await readFile(filePath, "utf-8");
}

reportsRoute.get("/", async (c) => {
  return c.html(await loadPage("report.html"));
});