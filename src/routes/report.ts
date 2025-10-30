import 'dotenv/config';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reports, posts, comments, users } from '../db/schema.js';
import { readFile } from "fs/promises";
import * as path from "path";

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