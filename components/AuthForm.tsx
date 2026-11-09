"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup } from "@/app/actions/auth";

const copy = {
  signup: {
    title: "Create your account",
    button: "Sign up",
    pending: "Creating account…",
    switchText: "Already have an account?",
    switchLink: "Log in",
    switchHref: "/login",
    autoComplete: "new-password",
  },
  login: {
    title: "Welcome back",
    button: "Log in",
    pending: "Logging in…",
    switchText: "New to Selfwind Planner?",
    switchLink: "Create an account",
    switchHref: "/signup",
    autoComplete: "current-password",
  },
} as const;

export default function AuthForm({ mode }: { mode: "signup" | "login" }) {
  const [state, action, pending] = useActionState(mode === "signup" ? signup : login, undefined);
  const c = copy[mode];

  return (
    <div className="auth-card">
      <h1>{c.title}</h1>
      <form action={action} noValidate>
        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state?.email}
          />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete={c.autoComplete} required minLength={mode === "signup" ? 8 : undefined} />
          {mode === "signup" && <span className="hint">At least 8 characters.</span>}
        </label>
        {state?.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? c.pending : c.button}
        </button>
      </form>
      <p className="auth-switch">
        {c.switchText} <Link href={c.switchHref}>{c.switchLink}</Link>
      </p>
    </div>
  );
}
