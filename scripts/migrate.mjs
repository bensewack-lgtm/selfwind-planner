// Creates or updates the auth tables. Safe to run any number of times.
// Runs automatically before every Vercel build, and locally with `npm run db:migrate`.
import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

nextEnv.loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) {
  if (process.env.VERCEL) {
    console.error("migrate: DATABASE_URL is not set for this Vercel environment.");
    process.exit(1);
  }
  console.warn("migrate: no DATABASE_URL found, skipping (run `vercel env pull` first).");
  process.exit(0);
}

const sql = neon(url);

await sql`
  CREATE TABLE IF NOT EXISTS users (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    has_paid      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now()
  )
`;

// If a users table already existed, make sure it has what the app needs.
const columns = await sql`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = current_schema() AND table_name = 'users'
`;
const types = Object.fromEntries(columns.map((c) => [c.column_name, c.data_type]));

for (const required of ["id", "email"]) {
  if (!types[required]) {
    console.error(`migrate: existing users table has no "${required}" column. Columns found: ${Object.keys(types).join(", ")}`);
    process.exit(1);
  }
}
if (!types.password_hash) await sql`ALTER TABLE users ADD COLUMN password_hash text`;
if (!types.has_paid) await sql`ALTER TABLE users ADD COLUMN has_paid boolean NOT NULL DEFAULT false`;
if (!types.created_at) await sql`ALTER TABLE users ADD COLUMN created_at timestamptz NOT NULL DEFAULT now()`;

// sessions.user_id must match the type of users.id.
const idTypes = { bigint: "bigint", integer: "integer", uuid: "uuid", text: "text" };
const userIdType = idTypes[types.id];
if (!userIdType) {
  console.error(`migrate: unsupported users.id type "${types.id}".`);
  process.exit(1);
}

await sql.query(`
  CREATE TABLE IF NOT EXISTS sessions (
    id         text PRIMARY KEY,
    user_id    ${userIdType} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )
`);
await sql`CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id)`;
await sql`DELETE FROM sessions WHERE expires_at < now()`;

// ---- Planner ----
// Times the planner works with are the user's local wall-clock time, stored as
// `timestamp` (no time zone). preferences.tz says which zone that is.

await sql.query(`
  CREATE TABLE IF NOT EXISTS preferences (
    user_id       ${userIdType} PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tz            text NOT NULL DEFAULT 'America/New_York',
    day_start_min integer NOT NULL DEFAULT 480,
    day_end_min   integer NOT NULL DEFAULT 1320,
    focus         text NOT NULL DEFAULT 'any' CHECK (focus IN ('any', 'morning', 'afternoon', 'evening')),
    max_block_min integer NOT NULL DEFAULT 90,
    break_min     integer NOT NULL DEFAULT 15,
    updated_at    timestamptz NOT NULL DEFAULT now()
  )
`);

// Fixed weekly commitments: classes, work shifts, practice.
await sql.query(`
  CREATE TABLE IF NOT EXISTS commitments (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     ${userIdType} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       text NOT NULL,
    day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_min   integer NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
    end_min     integer NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
    CHECK (end_min > start_min)
  )
`);
await sql`CREATE INDEX IF NOT EXISTS commitments_user_idx ON commitments (user_id)`;

// Assignments and other work that needs time set aside before a deadline.
await sql.query(`
  CREATE TABLE IF NOT EXISTS tasks (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    ${userIdType} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      text NOT NULL,
    due_at     timestamp NOT NULL,
    est_min    integer NOT NULL CHECK (est_min > 0),
    priority   smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
    done_at    timestamptz,
    actual_min integer,
    created_at timestamptz NOT NULL DEFAULT now()
  )
`);
await sql`CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks (user_id)`;

// Work sessions the planner schedules. 'planned' future blocks are regenerated
// whenever the plan changes; 'done' and 'missed' blocks are kept as history.
await sql.query(`
  CREATE TABLE IF NOT EXISTS blocks (
    id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id  ${userIdType} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id  bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    start_at timestamp NOT NULL,
    end_at   timestamp NOT NULL,
    status   text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'missed')),
    CHECK (end_at > start_at)
  )
`);
await sql`CREATE INDEX IF NOT EXISTS blocks_user_start_idx ON blocks (user_id, start_at)`;

console.log("migrate: users, sessions and planner tables are ready.");
