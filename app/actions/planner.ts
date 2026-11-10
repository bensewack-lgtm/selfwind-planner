"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { aiAvailable, readQuickAdd, type QuickAddSource } from "@/lib/ai";
import { sql } from "@/lib/db";
import { FREE_TASK_LIMIT, getCancelContext, getPrefs } from "@/lib/planner";
import { MAX_NOTES } from "@/lib/calendar-items";
import { PLANS } from "@/lib/plans";
import { isProblem, MAX_INPUT_CHARS, MAX_ITEMS, validateItem, type QuickItem } from "@/lib/quick-add";
import { getCurrentUser, type User } from "@/lib/session";
import { hhmmToMinutes, isValidTimeZone, nowLocal, parseLocal, toSqlTimestamp } from "@/lib/time";

export type FormState = { error?: string; ok?: string; upgrade?: boolean } | undefined;

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

/** Cancel one day of a weekly class or commitment. It stays in the routine for every other week. */
export async function skipCommitmentDay(fd: FormData) {
  const user = await requireUser();
  const id = idFrom(fd);
  const date = str(fd, "date");
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  await sql()`
    INSERT INTO commitment_skips (commitment_id, user_id, day)
    SELECT id, user_id, ${date}::date FROM commitments
    WHERE id = ${id} AND user_id = ${user.id} AND day_of_week = EXTRACT(DOW FROM ${date}::date)
    ON CONFLICT DO NOTHING
  `;
  refresh();
}

/** Undo a one-day cancellation. */
export async function restoreCommitmentDay(fd: FormData) {
  const user = await requireUser();
  const id = idFrom(fd);
  const date = str(fd, "date");
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  await sql()`DELETE FROM commitment_skips WHERE commitment_id = ${id} AND user_id = ${user.id} AND day = ${date}::date`;
  refresh();
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
      return {
        error: `The free plan plans up to ${FREE_TASK_LIMIT} assignments at a time. Finish one, or upgrade to Premium for unlimited.`,
        upgrade: true,
      };
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

// ---- Just type it ----

const DAILY_QUICK_ADDS = { free: PLANS.free.dailyQuickAdds, paid: PLANS.premium.dailyQuickAdds };

export type QuickAddState =
  | { stage: "preview"; text: string; items: QuickItem[]; problems: string[]; now: number; source: QuickAddSource }
  | { stage: "error"; text: string; error: string }
  | { stage: "saved"; message: string }
  | undefined;

/** Step 1: read the student's text with the AI and return a preview. Nothing is saved yet. */
export async function previewQuickAdd(_prev: QuickAddState, fd: FormData): Promise<QuickAddState> {
  const user = await requireUser();
  const prefs = await getPrefs(user.id);
  if (!prefs) redirect("/planner/setup");

  const text = str(fd, "text");
  if (!text) return { stage: "error", text, error: "Type what you've got going on first." };
  if (text.length > MAX_INPUT_CHARS) {
    return { stage: "error", text, error: `That's a lot! Keep it under ${MAX_INPUT_CHARS} characters and send the rest separately.` };
  }

  // AI requests are limited per day to keep costs predictable. Past the limit
  // (or with no API key) the free parser takes over, so it always works.
  let useAI = aiAvailable();
  if (useAI) {
    const limit = user.hasPaid ? DAILY_QUICK_ADDS.paid : DAILY_QUICK_ADDS.free;
    const [{ n }] = await sql()`
      SELECT count(*)::int AS n FROM quick_adds WHERE user_id = ${user.id} AND created_at > now() - interval '1 day'
    `;
    if (n >= limit) useAI = false;
    else await sql()`INSERT INTO quick_adds (user_id) VALUES (${user.id})`;
  }

  const now = nowLocal(prefs.tz);
  try {
    const ctx = await getCancelContext(user.id, now);
    const { items, problems, source } = await readQuickAdd(text, now, prefs.tz, useAI, ctx);
    if (items.length === 0) {
      return { stage: "error", text, error: problems[0] ?? "Didn't find anything to add. Try including a day, like “dentist Thursday at 3”." };
    }
    return { stage: "preview", text, items, problems, now, source };
  } catch (error) {
    console.error("quick add failed", error);
    return { stage: "error", text, error: "Something went wrong reading that. Try again." };
  }
}

/** Step 2: save the items the student kept. Every item is re-checked; the browser isn't trusted. */
export async function confirmQuickAdd(_prev: QuickAddState, fd: FormData): Promise<QuickAddState> {
  const user = await requireUser();
  const prefs = await getPrefs(user.id);
  if (!prefs) redirect("/planner/setup");

  let incoming: unknown;
  try {
    incoming = JSON.parse(str(fd, "items"));
  } catch {
    return { stage: "error", text: "", error: "Something went wrong. Try again." };
  }
  if (!Array.isArray(incoming) || incoming.length === 0) return { stage: "error", text: "", error: "Nothing left to add." };

  const now = nowLocal(prefs.tz);
  const items: QuickItem[] = [];
  for (const raw of incoming.slice(0, MAX_ITEMS)) {
    const checked = validateItem(raw as QuickItem, now);
    if (!isProblem(checked)) items.push(checked);
  }
  if (items.length === 0) return { stage: "error", text: "", error: "Those items couldn't be added. Try again." };

  const newTasks = items.filter((i) => i.kind === "task");
  if (!user.hasPaid && newTasks.length > 0) {
    const [{ n }] = await sql()`SELECT count(*)::int AS n FROM tasks WHERE user_id = ${user.id} AND done_at IS NULL`;
    if (n + newTasks.length > FREE_TASK_LIMIT) {
      return {
        stage: "error",
        text: "",
        error: `That would put you over the free plan's ${FREE_TASK_LIMIT} assignments (you have ${n}). Remove an assignment from the preview, or upgrade.`,
      };
    }
  }

  const db = sql();
  const queries = items.flatMap((item) => {
    switch (item.kind) {
      case "event":
        return [db`
          INSERT INTO events (user_id, title, start_at, end_at, all_day, location)
          VALUES (${user.id}, ${item.title}, ${toSqlTimestamp(item.start)}, ${toSqlTimestamp(item.end)}, ${item.allDay}, ${item.location})
        `];
      case "task":
        return [db`
          INSERT INTO tasks (user_id, title, due_at, est_min, priority)
          VALUES (${user.id}, ${item.title}, ${toSqlTimestamp(item.due)}, ${item.estMin}, ${item.priority})
        `];
      case "commitment":
        return [db`
          INSERT INTO commitments (user_id, title, day_of_week, start_min, end_min)
          SELECT ${user.id}, ${item.title}, d, ${item.start}, ${Math.min(item.end, 1440)} FROM unnest(${item.days}::smallint[]) AS d
        `];
      case "cancel": {
        if (item.target === "event") {
          return [db`DELETE FROM events WHERE id = ${item.targetId} AND user_id = ${user.id}`];
        }
        // Only a class this student owns, and only on a day it actually meets.
        const day = toSqlTimestamp(item.start).slice(0, 10);
        return [db`
          INSERT INTO commitment_skips (commitment_id, user_id, day)
          SELECT id, user_id, ${day}::date FROM commitments
          WHERE id = ${item.targetId} AND user_id = ${user.id} AND day_of_week = EXTRACT(DOW FROM ${day}::date)
          ON CONFLICT DO NOTHING
        `];
      }
    }
  });
  await db.transaction(queries);
  refresh();

  const count = (kind: QuickItem["kind"]) => items.filter((i) => i.kind === kind).length;
  const parts = [
    count("event") && `${count("event")} event${count("event") === 1 ? "" : "s"}`,
    count("task") && `${count("task")} assignment${count("task") === 1 ? "" : "s"}`,
    count("commitment") && `${count("commitment")} weekly commitment${count("commitment") === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const canceled = items.filter((i) => i.kind === "cancel").map((i) => `“${i.title}”`);
  const sentences = [
    parts.length ? `Added ${parts.join(", ")}.` : "",
    canceled.length ? `Canceled ${canceled.join(", ")}.` : "",
  ].filter(Boolean);
  return { stage: "saved", message: `${sentences.join(" ")} Your week has been rebuilt.` };
}

/** Manual "Event" form: something at a fixed date and time, placed exactly there. */
export async function addEvent(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const prefs = await getPrefs(user.id);
  if (!prefs) redirect("/planner/setup");

  const title = str(fd, "title").slice(0, 120);
  const date = str(fd, "date");
  const allDay = fd.get("allDay") === "on";
  const location = str(fd, "location").slice(0, 120) || null;
  if (!title) return { error: "What's the event called?" };

  let day: number;
  try {
    day = parseLocal(`${date}T00:00`);
  } catch {
    return { error: "Pick a date." };
  }

  let start = day;
  let end = day + 24 * 60;
  if (!allDay) {
    const s = hhmmToMinutes(str(fd, "start"));
    if (s === null) return { error: "Pick a start time, or tick “All day”." };
    const e = str(fd, "end") ? hhmmToMinutes(str(fd, "end")) : s + 60;
    if (e === null) return { error: "That end time doesn't look right." };
    start = day + s;
    end = e > s ? day + e : day + 24 * 60 + e; // an end before the start means it runs past midnight
  }

  const checked = validateItem({ kind: "event", title, start, end, allDay, location }, nowLocal(prefs.tz));
  if (isProblem(checked)) return { error: checked.problem };

  await sql()`
    INSERT INTO events (user_id, title, start_at, end_at, all_day, location)
    VALUES (${user.id}, ${title}, ${toSqlTimestamp(start)}, ${toSqlTimestamp(end)}, ${allDay}, ${location})
  `;
  refresh();
  return { ok: `Added “${title}” to your calendar.` };
}

export async function deleteEvent(fd: FormData) {
  const user = await requireUser();
  const id = idFrom(fd);
  if (id) await sql()`DELETE FROM events WHERE id = ${id} AND user_id = ${user.id}`;
  refresh();
}

// ---- Notes ----

/** Save the notes on a calendar item. Study sessions save to their assignment; a class's notes apply to all its days. */
export async function saveNotes(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = idFrom(fd);
  const kind = str(fd, "kind");
  const raw = String(fd.get("notes") ?? "").replace(/\r\n/g, "\n").trim();
  if (!id) return { error: "Something went wrong. Close this and try again." };
  if (raw.length > MAX_NOTES) return { error: `Notes can be up to ${MAX_NOTES} characters (yours are ${raw.length}).` };
  const notes = raw || null;
  const db = sql();

  let rows: Record<string, unknown>[];
  if (kind === "event") {
    rows = await db`UPDATE events SET notes = ${notes} WHERE id = ${id} AND user_id = ${user.id} RETURNING id`;
  } else if (kind === "task") {
    rows = await db`UPDATE tasks SET notes = ${notes} WHERE id = ${id} AND user_id = ${user.id} RETURNING id`;
  } else if (kind === "commitment") {
    rows = await db`
      UPDATE commitments c SET notes = ${notes}
      FROM commitments src
      WHERE src.id = ${id} AND src.user_id = ${user.id}
        AND c.user_id = src.user_id AND c.title = src.title AND c.start_min = src.start_min AND c.end_min = src.end_min
      RETURNING c.id
    `;
  } else {
    return { error: "Something went wrong. Close this and try again." };
  }
  if (rows.length === 0) return { error: "That item doesn't exist any more. It may have been deleted." };

  refresh();
  return { ok: notes ? "Notes saved." : "Notes cleared." };
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
