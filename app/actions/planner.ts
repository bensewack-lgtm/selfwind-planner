"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { FREE_TASK_LIMIT, getPrefs } from "@/lib/planner";
import { getCurrentUser, type User } from "@/lib/session";
import { hhmmToMinutes, isValidTimeZone, nowLocal, parseLocal, toSqlTimestamp } from "@/lib/time";

export type FormState = { error?: string; ok?: string } | undefined;

async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function idFrom(fd: FormData): string | null {
  const id = str(fd, "id");
  return /^\d+$/.test(id) ? id : null;
}

function refresh() {
  revalidatePath("/planner");
  revalidatePath("/planner/setup");
}

// ---- Routine & preferences ----

export async function savePreferences(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const dayStart = hhmmToMinutes(str(fd, "dayStart"));
  const dayEnd = hhmmToMinutes(str(fd, "dayEnd"));
  const focus = str(fd, "focus");
  const maxBlock = Number(str(fd, "maxBlock"));
  const breakMin = Number(str(fd, "breakMin"));
  const tzInput = str(fd, "tz");

  if (dayStart === null || dayEnd === null || dayEnd - dayStart < 60) {
    return { error: "Your day needs to end at least an hour after it starts." };
  }
  if (!["any", "morning", "afternoon", "evening"].includes(focus)) return { error: "Pick a focus time." };
  if (![30, 45, 60, 90, 120].includes(maxBlock)) return { error: "Pick a session length." };
  if (![0, 5, 10, 15, 30].includes(breakMin)) return { error: "Pick a break length." };

  const existing = await getPrefs(user.id);
  const tz = isValidTimeZone(tzInput) ? tzInput : (existing?.tz ?? "America/New_York");

  await sql()`
    INSERT INTO preferences (user_id, tz, day_start_min, day_end_min, focus, max_block_min, break_min)
    VALUES (${user.id}, ${tz}, ${dayStart}, ${dayEnd}, ${focus}, ${maxBlock}, ${breakMin})
    ON CONFLICT (user_id) DO UPDATE SET
      tz = EXCLUDED.tz, day_start_min = EXCLUDED.day_start_min, day_end_min = EXCLUDED.day_end_min,
      focus = EXCLUDED.focus, max_block_min = EXCLUDED.max_block_min, break_min = EXCLUDED.break_min,
      updated_at = now()
  `;
  refresh();
  redirect("/planner");
}

export async function addCommitment(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const title = str(fd, "title").slice(0, 80);
  const days = fd.getAll("days").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const start = hhmmToMinutes(str(fd, "start"));
  const end = hhmmToMinutes(str(fd, "end"));

  if (!title) return { error: "Give it a name, like “Biology lecture” or “Work”." };
  if (days.length === 0) return { error: "Pick at least one day." };
  if (start === null || end === null || end <= start) return { error: "The end time has to be after the start time." };

  const [{ n }] = await sql()`SELECT count(*)::int AS n FROM commitments WHERE user_id = ${user.id}`;
  if (n + days.length > 60) return { error: "That's a lot of commitments. Remove some first." };

  await sql()`
    INSERT INTO commitments (user_id, title, day_of_week, start_min, end_min)
    SELECT ${user.id}, ${title}, d, ${start}, ${end} FROM unnest(${[...new Set(days)]}::smallint[]) AS d
  `;
  refresh();
  return { ok: `Added ${title}.` };
}

export async function deleteCommitment(fd: FormData) {
  const user = await requireUser();
  const id = idFrom(fd);
  if (id) await sql()`DELETE FROM commitments WHERE id = ${id} AND user_id = ${user.id}`;
  refresh();
}

// ---- Tasks ----

export async function addTask(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const prefs = await getPrefs(user.id);
  if (!prefs) redirect("/planner/setup");

  const title = str(fd, "title").slice(0, 120);
  const dueRaw = str(fd, "due");
  const hours = Number(str(fd, "hours"));
  const priority = Number(str(fd, "priority"));

  if (!title) return { error: "What's the assignment called?" };
  let due: number;
  try {
    due = parseLocal(dueRaw);
  } catch {
    return { error: "Pick a due date and time." };
  }
  if (due <= nowLocal(prefs.tz)) return { error: "That due date has already passed." };
  if (!Number.isFinite(hours) || hours < 0.25 || hours > 100) return { error: "Estimate between 15 minutes and 100 hours." };
  if (![1, 2, 3].includes(priority)) return { error: "Pick a priority." };

  if (!user.hasPaid) {
    const [{ n }] = await sql()`SELECT count(*)::int AS n FROM tasks WHERE user_id = ${user.id} AND done_at IS NULL`;
    if (n >= FREE_TASK_LIMIT) {
      return { error: `The free plan plans up to ${FREE_TASK_LIMIT} assignments at a time. Finish one, or upgrade for unlimited.` };
    }
  }

  await sql()`
    INSERT INTO tasks (user_id, title, due_at, est_min, priority)
    VALUES (${user.id}, ${title}, ${toSqlTimestamp(due)}, ${Math.round(hours * 60)}, ${priority})
  `;
  refresh();
  return { ok: `Added “${title}” and rebuilt your plan.` };
}

export async function completeTask(fd: FormData) {
  const user = await requireUser();
  const id = idFrom(fd);
  const hours = Number(str(fd, "actualHours"));
  if (!id) return;
  const actual = Number.isFinite(hours) && hours > 0 && hours <= 200 ? Math.round(hours * 60) : null;
  const prefs = await getPrefs(user.id);
  const nowSql = toSqlTimestamp(nowLocal(prefs?.tz ?? "America/New_York"));

  await sql().transaction([
    sql()`UPDATE tasks SET done_at = now(), actual_min = ${actual} WHERE id = ${id} AND user_id = ${user.id} AND done_at IS NULL`,
    // Past sessions nobody confirmed count as done; future ones are no longer needed.
    sql()`UPDATE blocks SET status = 'done' WHERE task_id = ${id} AND user_id = ${user.id} AND status = 'planned' AND start_at < ${nowSql}`,
    sql()`DELETE FROM blocks WHERE task_id = ${id} AND user_id = ${user.id} AND status = 'planned'`,
  ]);
  refresh();
}

export async function deleteTask(fd: FormData) {
  const user = await requireUser();
  const id = idFrom(fd);
  if (id) await sql()`DELETE FROM tasks WHERE id = ${id} AND user_id = ${user.id}`;
  refresh();
}

// ---- Sessions ----

export async function setBlockStatus(fd: FormData) {
  const user = await requireUser();
  const id = idFrom(fd);
  const status = str(fd, "status");
  if (!id || !["done", "missed"].includes(status)) return;
  const prefs = await getPrefs(user.id);
  const nowSql = toSqlTimestamp(nowLocal(prefs?.tz ?? "America/New_York"));
  // Only sessions that have started can be marked; the rest are still just a plan.
  await sql()`
    UPDATE blocks SET status = ${status}
    WHERE id = ${id} AND user_id = ${user.id} AND start_at <= ${nowSql}
  `;
  refresh();
}
