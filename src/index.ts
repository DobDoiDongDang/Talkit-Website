import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { authRoute } from "./routes/auth.js";
import { postRoute } from "./routes/post.js";
import { homeRoute } from "./routes/home.js";

const app = new Hono();

// รวม route ของ auth ทั้งหมดไว้ที่ / 
app.route("auth", authRoute);
app.route("post", postRoute);
app.route("home", homeRoute);

// ✅ เสิร์ฟไฟล์จาก public
app.use("/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: 3000 });
console.log("🚀 Server running at http://localhost:3000");
