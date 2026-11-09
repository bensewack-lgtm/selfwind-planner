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

console.log("migrate: users and sessions tables are ready.");
