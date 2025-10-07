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
} from "@aws-sdk/client-cognito-identity-provider";

const authRoute = new Hono();

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
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    });
    const res = await client.send(command);
    return c.json({ success: true, message: "เข้าสู่ระบบสำเร็จ", data: res.AuthenticationResult });
  } catch (err: any) {
    if (err.name === "UserNotConfirmedException") {
      return c.json({ success: false, redirect: "/confirm", message: "บัญชียังไม่ยืนยัน โปรดยืนยันก่อนเข้าสู่ระบบ" });
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
    return c.json({ success: true, redirect: "/", message: "ยืนยันสำเร็จแล้ว สามารถเข้าสู่ระบบได้เลย" });
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

export { authRoute };
