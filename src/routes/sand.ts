import 'dotenv/config';
import { Hono } from "hono";
import { readFile } from "fs/promises";
import * as path from "path";
import { db } from '../db/index.js';
import { categories } from '../db/schema.js';

import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie } from "hono/cookie";

const sandRoute = new Hono();

async function loadPage(filename: string) {
  const filePath = path.join(process.cwd(), "src/pages", filename);
  return await readFile(filePath, "utf-8");
}

sandRoute.use(
  "/",
  serveStatic({
    root: path.join(process.cwd(), "src/pages"),
  })
);

sandRoute.get("/", async (c) => {
  return c.html(await loadPage("sandbox.html"));
});

sandRoute.post("/run", async (c) => {
  const form = await c.req.formData();
  const code = form.get("code") as string;
  const pythonApiUrl = process.env.PYTHON_LAMBDA_API;
  if (!pythonApiUrl) {
    return c.json({ error: "PYTHON_LAMBDA_API is not configured." }, 500);
  }
  try {
    const response = await fetch(pythonApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });
    const result = await response.json();
    return c.json(result);
  } catch (error) {
    return c.json({ error: "Failed to execute code." }, 500);
  }
});

export { sandRoute };
