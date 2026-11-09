import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | undefined;

// Neon's Vercel integration exposes the connection string as DATABASE_URL
// (and POSTGRES_URL on older setups). Created lazily so `next build` works
// without a database connection.
export function sql() {
  if (!client) {
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!url) {
      throw new Error(
        "No database connection string found. Set DATABASE_URL (run `vercel env pull` to get it locally).",
      );
    }
    client = neon(url);
  }
  return client;
}
