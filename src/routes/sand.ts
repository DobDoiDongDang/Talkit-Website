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

export { sandRoute };
