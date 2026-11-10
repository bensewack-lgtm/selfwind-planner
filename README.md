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

## The planner (v1)

At `/planner`, a student sets up their fixed weekly schedule (classes, work) and
how they like to work, then adds assignments with a due date and an estimate.

- **It builds the week:** `lib/scheduler.ts` places study sessions in free time
  before each deadline: earliest deadline first, spread across days, no session
  shorter than 30 minutes, breaks between sessions, and preferred focus time first.
- **It adapts:** the plan is rebuilt on every visit and after every change. Missed
  sessions get rescheduled, finished work frees up time, and new assignments slot in.
- **It learns:**
  - *Pace:* after 2 finished assignments, it compares the actual hours with the
    estimates and scales future estimates to match.
  - *Focus time:* after 6 sessions marked done or missed, it schedules the time
    of day you actually follow through on first.
- **Plans:** the free plan schedules up to 5 assignments at a time. Accounts with
  `has_paid = true` have no limit.

### Demo data

```bash
npm run seed:demo
```

This fills `demo@demo.com` with a realistic student week (classes, a job,
assignments and two weeks of history) relative to today. It replaces that
account's planner data but leaves the login alone. Re-run it before presenting.
Pass another email to seed a different account: `npm run seed:demo -- me@school.edu`.

## How auth works

- `users`: `id`, `email` (unique, stored lowercase), `password_hash`, `has_paid` (default `false`), `created_at`.
- Passwords are hashed with scrypt (Node's built-in crypto) with a unique random salt per user.
- Logging in creates a row in `sessions` and sets an httpOnly cookie that lasts 30 days.
  The database stores only a SHA-256 of the cookie token. Logging out deletes the row and the cookie.
- No email verification.

Code: `lib/db.ts`, `lib/password.ts`, `lib/session.ts`, `app/actions/auth.ts`, `scripts/migrate.mjs`.
