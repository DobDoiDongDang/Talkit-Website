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

// code execution endpoint
sandRoute.post("/run", async (c) => {
  console.log("Received code execution request.");
  const { code } = await c.req.json(); 

  try {
    const response = await fetch("http://localhost:8000/run", { // <-- fix URL
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    const result = await response.json();
    console.log("Execution result:", result);
    return c.json(result);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Failed to execute code." }, 500);
  }
});


export { sandRoute };
