import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { authRoute } from "./routes/auth.js";

const app = new Hono();

// รวม route ของ auth ทั้งหมดไว้ที่ / 
app.route("auth", authRoute);

serve({ fetch: app.fetch, port: 3000 });
console.log("🚀 Server running at http://localhost:3000");
