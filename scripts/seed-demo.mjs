// Fills an existing account with a realistic student week so the planner has
// something to show. Wipes that account's planner data first; the login itself
// is untouched. Dates are relative to today, so re-run it before a demo.
//
//   npm run seed:demo                 (seeds demo@demo.com)
//   npm run seed:demo -- me@school.edu
import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("seed: no DATABASE_URL found. Run `vercel env pull .env.local` first.");
  process.exit(1);
}
const sql = neon(url);

const email = (process.argv[2] ?? "demo@demo.com").trim().toLowerCase();
const TZ = process.env.DEMO_TZ ?? "America/New_York";

const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
if (!user) {
  console.error(`seed: no account for ${email}. Sign up first.`);
  process.exit(1);
}
const uid = user.id;

// ---- local-time helpers (same idea as lib/time.ts) ----
const DAY = 1440;
const parts = Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date())
    .map((p) => [p.type, p.value]),
);
const now = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`) / 60000;
const today = now - (now % DAY);
const at = (dayOffset, h, m = 0) => today + dayOffset * DAY + h * 60 + m;
const sqlTs = (lm) => new Date(lm * 60000).toISOString().slice(0, 16).replace("T", " ");
const t = (h, m = 0) => h * 60 + m;

// ---- wipe this account's planner data ----
await sql.transaction([
  sql`DELETE FROM blocks WHERE user_id = ${uid}`,
  sql`DELETE FROM tasks WHERE user_id = ${uid}`,
  sql`DELETE FROM commitments WHERE user_id = ${uid}`,
  sql`DELETE FROM preferences WHERE user_id = ${uid}`,
]);

// Picked "morning", but the history below shows afternoons work better, so
// the planner will override it. That's the learning in action.
await sql`
  INSERT INTO preferences (user_id, tz, day_start_min, day_end_min, focus, max_block_min, break_min)
  VALUES (${uid}, ${TZ}, ${t(8)}, ${t(23)}, 'morning', 90, 15)
`;

// day_of_week: 0 Sun ... 6 Sat
const commitments = [
  ["BIOL 110 Lecture", [1, 3, 5], t(9, 5), t(9, 55)],
  ["ENGL 15", [1, 3, 5], t(11, 15), t(12, 5)],
  ["CHEM 110 Lecture", [2, 4], t(10, 35), t(11, 50)],
  ["MATH 140", [2, 4], t(13, 35), t(14, 50)],
  ["Chem lab", [3], t(14, 30), t(17, 30)],
  ["Work: campus café", [2, 4], t(17, 0), t(20, 0)],
  ["Work: campus café", [6], t(10, 0), t(14, 0)],
  ["Club soccer", [1, 3], t(19, 0), t(20, 30)],
];
for (const [title, days, start, end] of commitments) {
  await sql`
    INSERT INTO commitments (user_id, title, day_of_week, start_min, end_min)
    SELECT ${uid}, ${title}, d, ${start}, ${end} FROM unnest(${days}::smallint[]) AS d
  `;
}

// ---- finished work (teaches pace: ~1.25x estimates) ----
const finished = [
  ["Chem problem set 6", 180, 225, 3],
  ["MATH 140 WebWork 9", 60, 75, 5],
  ["ENGL 15 reading response", 90, 105, 8],
];
const doneIds = [];
for (const [title, est, actual, daysAgo] of finished) {
  const [row] = await sql`
    INSERT INTO tasks (user_id, title, due_at, est_min, priority, done_at, actual_min)
    VALUES (${uid}, ${title}, ${sqlTs(at(-daysAgo, 23, 59))}, ${est}, 2, now() - make_interval(days => ${daysAgo}), ${actual})
    RETURNING id
  `;
  doneIds.push(row.id);
}

// ---- session history (teaches focus time: afternoons stick, mornings don't) ----
const history = [
  // [daysAgo, hour, minute, minutes, status]
  [13, 14, 0, 60, "done"], [12, 15, 30, 90, "done"], [11, 13, 0, 60, "done"],
  [9, 15, 0, 60, "done"], [7, 14, 0, 90, "done"], [6, 16, 0, 60, "done"], [4, 13, 30, 60, "missed"],
  [12, 8, 0, 60, "missed"], [10, 8, 30, 60, "missed"], [8, 8, 0, 60, "done"], [5, 8, 0, 45, "missed"],
  [11, 20, 30, 60, "done"], [9, 21, 0, 60, "done"], [6, 21, 0, 60, "missed"], [3, 20, 45, 60, "done"],
];
for (const [i, [daysAgo, h, m, len, status]] of history.entries()) {
  const start = at(-daysAgo, h, m);
  await sql`
    INSERT INTO blocks (user_id, task_id, start_at, end_at, status)
    VALUES (${uid}, ${doneIds[i % doneIds.length]}, ${sqlTs(start)}, ${sqlTs(start + len)}, ${status})
  `;
}

// ---- what's on the student's plate now ----
const active = [
  // [title, due day offset, due hour, due minute, estimate minutes, priority]
  ["MATH 140 WebWork 10", 1, 23, 59, 90, 2],
  ["Chem problem set 7", 2, 23, 59, 180, 3],
  ["BIOL quiz 4 review", 3, 9, 0, 120, 2],
  ["ENGL 15 essay draft", 5, 23, 59, 360, 2],
  ["Titration lab report", 7, 17, 0, 240, 3],
];
const activeIds = {};
for (const [title, d, h, m, est, priority] of active) {
  const [row] = await sql`
    INSERT INTO tasks (user_id, title, due_at, est_min, priority)
    VALUES (${uid}, ${title}, ${sqlTs(at(d, h, m))}, ${est}, ${priority})
    RETURNING id
  `;
  activeIds[title] = row.id;
}

// Progress already made yesterday, plus one session from last night that the
// student hasn't confirmed yet (shows the "Did you do it?" prompt).
await sql`
  INSERT INTO blocks (user_id, task_id, start_at, end_at, status) VALUES
    (${uid}, ${activeIds["ENGL 15 essay draft"]}, ${sqlTs(at(-1, 14, 0))}, ${sqlTs(at(-1, 15, 30))}, 'done'),
    (${uid}, ${activeIds["Chem problem set 7"]}, ${sqlTs(at(-1, 15, 45))}, ${sqlTs(at(-1, 16, 45))}, 'done'),
    (${uid}, ${activeIds["MATH 140 WebWork 10"]}, ${sqlTs(at(-1, 21, 0))}, ${sqlTs(at(-1, 21, 45))}, 'planned')
`;

console.log(`seed: ${email} now has a full week (time zone ${TZ}). Open /planner to see it.`);
