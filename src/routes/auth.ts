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
import { AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";

// ✅ [แก้] import serveStatic จาก path ใหม่
import { serveStatic } from "@hono/node-server/serve-static";

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

    // ดึงข้อมูล user จาก accessToken
    const userRes = await client.send(new GetUserCommand({ AccessToken: accessToken }));
    const emailAttr = userRes.UserAttributes?.find(attr => attr.Name === "email");
    const email = emailAttr?.Value;
    if (!email) throw new Error("ไม่พบอีเมลใน Cognito");

    // ตรวจสอบว่ามี user ใน DB หรือยัง
  const userInDb = await db.select().from(users).where(eq(users.email, email));
    if (!userInDb.length) {
      await db.insert(users).values({
        email,
        displayName: username,
      });
    }

  // ✅ เก็บ AccessToken ใน Cookie (HTTP-only)
  c.header("Set-Cookie", `token=${accessToken}; HttpOnly; Path=/; Max-Age=3600; Secure`);

    return c.json({
      success: true,
      redirect: "/",
      message: "เข้าสู่ระบบสำเร็จ",
    });
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

    // ดึง email จาก Cognito หลังยืนยัน
    const adminGetUser = new AdminGetUserCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID!,
      Username: username,
    });
    const userRes = await client.send(adminGetUser);
    const emailAttr = userRes.UserAttributes?.find(attr => attr.Name === "email");
    const email = emailAttr?.Value;
    if (!email) throw new Error("ไม่พบอีเมลใน Cognito");

    // เพิ่ม user ลง database หลังยืนยันสำเร็จ
    await db.insert(users).values({
      email,
      displayName: username,
    });
    return c.json({ success: true, redirect: "/home", message: "ยืนยันสำเร็จแล้ว กำลังเข้าสู่ระบบ..." });
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
