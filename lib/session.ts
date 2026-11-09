import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "./db";

const COOKIE = "session";
const SESSION_DAYS = 30;

export type User = { id: string; email: string; hasPaid: boolean };

// The cookie holds a random token; the database only stores its SHA-256,
// so a leaked sessions table can't be used to log in.
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function setCookie(token: string, expires: Date) {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sql()`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (${hashToken(token)}, ${userId}, ${expires.toISOString()})
  `;
  await setCookie(token, expires);
}

// Cached per request, so the header and the page share one lookup.
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const rows = await sql()`
    SELECT u.id::text AS id, u.email, u.has_paid
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ${hashToken(token)} AND s.expires_at > now()
  `;
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, hasPaid: row.has_paid };
});

export async function deleteSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await sql()`DELETE FROM sessions WHERE id = ${hashToken(token)}`;
  store.delete(COOKIE);
}
