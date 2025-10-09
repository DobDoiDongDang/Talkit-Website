import type { Context, Next } from "hono";
import jwt from "jsonwebtoken";
import { getCookie } from "hono/cookie";
import fetch from "node-fetch";
import jwkToPem from "jwk-to-pem";
import 'dotenv/config';

const JWKS_URL = process.env.COGNITO_JWT_PUBLIC_KEY!; // URL ของ JWKs

let cachedJwks: any[] | null = null;
async function getJwkForKid(kid: string) {
  if (!cachedJwks) {
    const res = await fetch(JWKS_URL);
    const data = await res.json() as { keys: any[] };
    cachedJwks = data.keys;
  }
  return cachedJwks ? cachedJwks.find(jwk => jwk.kid === kid) : undefined;
}

export async function authMiddleware(c: Context, next: Next) {
  try {
    const accessToken = getCookie(c, "token");
    if (!accessToken) return c.redirect("/auth");
    // decode header เพื่อเอา kid
    const header = JSON.parse(Buffer.from(accessToken.split(".")[0], "base64").toString());
    const jwk = await getJwkForKid(header.kid);
    if (!jwk) throw new Error("JWK not found for kid");
    const pem = jwkToPem(jwk);
    const decoded = jwt.verify(accessToken, pem, { algorithms: ["RS256"] });
    c.set("user", decoded);
    await next();
  } catch (err) {
    console.error("❌ Auth Middleware Error:", err);
    return c.redirect("/auth");
  }
}