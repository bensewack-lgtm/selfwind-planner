# Selfwind Planner

Next.js app deployed on Vercel, with email/password accounts stored in Neon Postgres.

## Running locally

### 1. Pull your environment variables from Vercel (one time)

The Neon connection string lives in your Vercel project's environment variables.
The Vercel CLI copies them into a local `.env.local` file, which is git-ignored.

```bash
npx vercel login
```

```bash
npx vercel link
```

Answer the prompts: pick your account, say **yes** to linking an existing project, and choose `selfwind-planner`.

```bash
npx vercel env pull .env.local
```

Open `.env.local` and check that it has a `DATABASE_URL=` line (or `POSTGRES_URL=`).
Run `npx vercel env pull .env.local` again whenever you change variables in Vercel.

### 2. Create the database tables

```bash
npm run db:migrate
```

This creates the `users` table (with `has_paid`) and a `sessions` table. It's safe
to run any number of times. It also runs automatically before every Vercel build,
so production gets the tables on its next deploy.

### 3. Start the dev server

```bash
npm run dev
```

Open http://localhost:3000 and try **Sign up**, **Log out** and **Log in**.

## How auth works

- `users`: `id`, `email` (unique, stored lowercase), `password_hash`, `has_paid` (default `false`), `created_at`.
- Passwords are hashed with scrypt (Node's built-in crypto) with a unique random salt per user.
- Logging in creates a row in `sessions` and sets an httpOnly cookie that lasts 30 days.
  The database stores only a SHA-256 of the cookie token. Logging out deletes the row and the cookie.
- No email verification.

Code: `lib/db.ts`, `lib/password.ts`, `lib/session.ts`, `app/actions/auth.ts`, `scripts/migrate.mjs`.
