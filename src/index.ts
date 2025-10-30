import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { authMiddleware } from "./middlewares/authMiddleware.js";
import { authRoute } from "./routes/auth.js";
import { postRoute } from "./routes/post.js";
import { editPostRoute } from "./routes/editPost.js"; // เพิ่มการ import
import { homeRoute } from "./routes/home.js";
import { sandRoute } from "./routes/sand.js";
import { getCookie } from "hono/cookie";
import { commentRoute } from "./routes/comment.js";
import { profilesRoute } from "./routes/profiles.js";
import { reportsRoute } from "./routes/report.js";

import 'dotenv/config';

const app = new Hono();

app.use("/auth/*", async (c, next) => {
    const token = getCookie(c, "token");
    if (token) {
        // ถ้ามี token ให้ redirect ไปหน้าหลัก
        return c.redirect("/");
    }
    await next();
});

app.route("auth", authRoute);
app.use("/*", serveStatic({ root: "./public" }));
app.use("/*", authMiddleware);
app.route("/", homeRoute);
app.route("sand", sandRoute);
app.route("posts", postRoute);
app.route("edit_post", editPostRoute); // เพิ่ม route ใหม่
app.route("posts", commentRoute);
app.route("profiles", profilesRoute);
app.route("reports", reportsRoute);

app.get("/logout", (c) => {
  // ลบ cookie token โดยตั้ง Max-Age=0
  c.header("Set-Cookie", "token=; HttpOnly; Path=/; Max-Age=0; Secure");
  return c.redirect("/auth");
});

const PORT : number = parseInt(process.env.PORT!)
serve({ fetch: app.fetch, port: PORT });
console.log("🚀 Server running at http://localhost:"+PORT);
