import 'dotenv/config';
import { Hono } from "hono";
import { readFile } from "fs/promises";
import * as path from "path";
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  GetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from "drizzle-orm";
// ลบ AdminGetUserCommand ไม่ใช้ admin API

// ✅ [แก้] import serveStatic จาก path ใหม่
import { serveStatic } from "@hono/node-server/serve-static";
import { setCookie } from "hono/cookie";

const authRoute = new Hono();

// ✅ [เพิ่ม] เสิร์ฟไฟล์ static (เช่น auth-style.css) จาก src/pages
authRoute.use(
  "/",
  serveStatic({
    root: path.join(process.cwd(), "src/pages"),
  })
);

// ตั้งค่า Cognito
const client = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});
const CLIENT_ID = process.env.COGNITO_CLIENT_ID!;

// ✅ Utility สำหรับโหลดหน้า HTML
async function loadPage(filename: string) {
  const filePath = path.join(process.cwd(), "src/pages", filename);
  return await readFile(filePath, "utf-8");
}

// ----------------------------------------------------
// 🔹 หน้า Login
// ----------------------------------------------------
authRoute.get("/", async (c) => {
  return c.html(await loadPage("login.html"));
});

authRoute.post("/login", async (c) => {
  const { username, password } = await c.req.json();
  try {
    const command = new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: username, PASSWORD: password },
    });

    const res = await client.send(command);
    const idToken = res.AuthenticationResult?.IdToken;
    const accessToken = res.AuthenticationResult?.AccessToken;

    if (!idToken || !accessToken) throw new Error("ไม่พบ Token");

    // ดึงข้อมูล user จาก accessToken (ไม่ใช้ admin)
    const userRes = await client.send(new GetUserCommand({ AccessToken: accessToken }));
    const emailAttr = userRes.UserAttributes?.find(attr => attr.Name === "email");
    const email = emailAttr?.Value;
    if (!email) throw new Error("ไม่พบอีเมลใน Cognito");

    // ตรวจสอบว่ามี user ใน DB หรือยัง
    let dbUsers = await db.select().from(users).where(eq(users.email, email));
    if (!dbUsers.length) {
      // ถ้าไม่มี ให้ insert แล้วดึงข้อมูลมาจาก DB อีกครั้งเพื่อเอา id
      await db.insert(users).values({
        email,
        username,
      });
      dbUsers = await db.select().from(users).where(eq(users.email, email));
    }

    const dbUser = dbUsers[0];
    if (!dbUser) throw new Error("ไม่สามารถบันทึกหรือดึงข้อมูลผู้ใช้จากฐานข้อมูลได้");

    // เก็บ AccessToken ใน Cookie (HTTP-only)
    setCookie(c, "token", accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60, // 1 hour
    });

    // เก็บข้อมูล user ที่จำเป็นให้ frontend อ่านได้ (ไม่ต้องเก็บ sensitive)
    const userInfo = JSON.stringify({
      id: dbUser.id,
      username: dbUser.username,
      email,
      userProfile: (dbUser as any).userProfile ?? null, // add profile to cookie
    });
    setCookie(c, "user", userInfo, {
      httpOnly: false, secure: true, sameSite: "Lax", path: "/", maxAge: 60 * 60,
    });

    return c.json({ success: true, redirect: "/", message: "เข้าสู่ระบบสำเร็จ" });
  } catch (err: any) {
    if (err.name === "UserNotConfirmedException") {
      return c.json({ success: false, redirect: "/confirm", message: "บัญชียังไม่ยืนยัน" });
    }
    return c.json({ success: false, message: err.message });
  }
});


// ----------------------------------------------------
// 🔹 สมัครสมาชิก
// ----------------------------------------------------
authRoute.get("/signup", async (c) => {
  return c.html(await loadPage("signup.html"));
});

authRoute.post("/signup", async (c) => {
  const { username, password, email } = await c.req.json();

  try {
    const command = new SignUpCommand({
      ClientId: CLIENT_ID,
      Username: username,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }],
    });
    await client.send(command);
    return c.json({ success: true, redirect: "/confirm", message: "สมัครสำเร็จ! โปรดยืนยันอีเมลของคุณ" });
  } catch (err: any) {
    return c.json({ success: false, message: err.message });
  }
});

// ----------------------------------------------------
// 🔹 ยืนยันตัวตน
// ----------------------------------------------------
authRoute.get("/confirm", async (c) => {
  return c.html(await loadPage("confirm.html"));
});

authRoute.post("/confirm", async (c) => {
  const { username, code } = await c.req.json();

  try {
    const command = new ConfirmSignUpCommand({
      ClientId: CLIENT_ID,
      Username: username,
      ConfirmationCode: code,
    });
    await client.send(command);
    // ไม่ต้องเพิ่ม user ใน database ที่นี่ เพราะไม่มี accessToken และไม่สามารถดึง email ได้โดยไม่ใช้ admin
    return c.json({ success: true, redirect: "/", message: "ยืนยันสำเร็จแล้ว กรุณาเข้าสู่ระบบ" });
  } catch (err: any) {
    return c.json({ success: false, message: err.message });
  }
});

// ----------------------------------------------------
// 🔹 ลืมรหัสผ่าน
// ----------------------------------------------------
authRoute.get("/forgot", async (c) => {
  return c.html(await loadPage("forgot.html"));
});

authRoute.post("/forgot", async (c) => {
  const { username } = await c.req.json();

  try {
    const command = new ForgotPasswordCommand({
      ClientId: CLIENT_ID,
      Username: username,
    });
    await client.send(command);
    return c.json({ success: true, message: "ส่งโค้ดยืนยันไปยังอีเมลของคุณแล้ว" });
  } catch (err: any) {
    return c.json({ success: false, message: err.message });
  }
});

authRoute.post("/forgot/confirm", async (c) => {
  const { username, code, newPassword } = await c.req.json();

  try {
    const command = new ConfirmForgotPasswordCommand({
      ClientId: CLIENT_ID,
      Username: username,
      ConfirmationCode: code,
      Password: newPassword,
    });
    await client.send(command);
    return c.json({ success: true, redirect: "/", message: "เปลี่ยนรหัสผ่านสำเร็จแล้ว" });
  } catch (err: any) {
    return c.json({ success: false, message: err.message });
  }
});

// ----------------------------------------------------
// 🔹 หน้ารีเซ็ตรหัสผ่าน
// ----------------------------------------------------
authRoute.get("/reset", async (c) => {
  return c.html(await loadPage("reset.html"));
});

authRoute.post("/reset", async (c) => {
  const { username, code, newPassword } = await c.req.json();

  try {
    const command = new ConfirmForgotPasswordCommand({
      ClientId: CLIENT_ID,
      Username: username,
      ConfirmationCode: code,
      Password: newPassword,
    });
    await client.send(command);
    return c.json({ success: true, redirect: "/", message: "รีเซ็ตรหัสผ่านสำเร็จ" });
  } catch (err: any) {
    return c.json({ success: false, message: err.message });
  }
});


export { authRoute };
