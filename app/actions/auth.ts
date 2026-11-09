"use server";

import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/password";
import { createSession, deleteSession } from "@/lib/session";

export type AuthState = { error?: string; email?: string } | undefined;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

function readForm(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
  };
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readForm(formData);

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return { error: "Enter a valid email address.", email };
  }
  if (password.length < MIN_PASSWORD) {
    return { error: `Password must be at least ${MIN_PASSWORD} characters.`, email };
  }
  if (password.length > MAX_PASSWORD) {
    return { error: `Password must be at most ${MAX_PASSWORD} characters.`, email };
  }

  const passwordHash = await hashPassword(password);
  const rows = await sql()`
    INSERT INTO users (email, password_hash)
    VALUES (${email}, ${passwordHash})
    ON CONFLICT (email) DO NOTHING
    RETURNING id::text AS id
  `;
  if (!rows[0]) {
    return { error: "An account with that email already exists. Try logging in.", email };
  }

  await createSession(rows[0].id);
  redirect("/account");
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readForm(formData);
  const invalid = { error: "Incorrect email or password.", email };

  if (!email || !password || password.length > MAX_PASSWORD) return invalid;

  const rows = await sql()`
    SELECT id::text AS id, password_hash FROM users WHERE email = ${email}
  `;
  const user = rows[0];
  if (!user?.password_hash) {
    await burnPasswordCheck(password);
    return invalid;
  }
  if (!(await verifyPassword(password, user.password_hash))) return invalid;

  await createSession(user.id);
  redirect("/account");
}

export async function logout() {
  await deleteSession();
  redirect("/");
}
