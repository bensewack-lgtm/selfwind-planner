import "server-only";
import { sql } from "./db";
import { PLANS } from "./plans";
import {
  buildSchedule,
  effectiveFocus,
  learnFocus,
  learnPace,
  STEP,
  type Commitment,
  type Focus,
  type FocusInsight,
  type PaceInsight,
} from "./scheduler";
import { DAY, dayOfWeek, nowLocal, parseLocal, roundUpTo, startOfDay, toSqlTimestamp } from "./time";

export const FREE_TASK_LIMIT = PLANS.free.taskLimit;
const PLAN_DAYS = 14;
const WEEK_DAYS = 7;

export type PlannerPrefs = {
  tz: string;
  dayStart: number;
  dayEnd: number;
  focus: Focus;
  maxBlock: number;
  breakMin: number;
};

export type CommitmentRow = Commitment & { id: string; title: string; notes: string | null };

export type TaskView = {
  id: string;
  title: string;
  due: number;
  estMin: number;
  priority: number;
  neededMin: number; // estimate adjusted by learned pace
  doneMin: number;
  plannedMin: number; // scheduled from now on
  unscheduledMin: number; // won't fit before the deadline
  overdue: boolean;
  notes: string | null;
};

export type BlockView = {
  id: string;
  taskId: string;
  title: string;
  start: number;
  end: number;
  status: "planned" | "done" | "missed";
};

export type EventView = {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string | null;
  notes: string | null;
};

export type PlannerData = {
  now: number;
  prefs: PlannerPrefs;
  commitments: CommitmentRow[];
  events: EventView[]; // from the start of today through the planning window
  tasks: TaskView[];
  blocks: BlockView[]; // this week (today + 6 days), plus any past unconfirmed blocks
  pace: PaceInsight;
  focus: FocusInsight;
  usedFocus: Focus;
  completedCount: number;
};

const ts = (col: unknown) => parseLocal(String(col));

export async function getPrefs(userId: string): Promise<PlannerPrefs | null> {
  const [row] = await sql()`
    SELECT tz, day_start_min, day_end_min, focus, max_block_min, break_min
    FROM preferences WHERE user_id = ${userId}
  `;
  if (!row) return null;
  return {
    tz: row.tz,
    dayStart: row.day_start_min,
    dayEnd: row.day_end_min,
    focus: row.focus,
    maxBlock: row.max_block_min,
    breakMin: row.break_min,
  };
}

export type MonthData = {
  key: string; // "2026-11"
  first: number; // local minutes, 1st of the month
  gridStart: number; // the Sunday on or before the 1st
  weeks: number;
  prevKey: string;
  nextKey: string;
  events: EventView[];
  deadlines: { id: string; title: string; due: number; done: boolean; notes: string | null }[];
  study: Record<number, { planned: number; done: number }>; // by day start, in minutes
};

const monthKeyOf = (lm: number) => toSqlTimestamp(lm).slice(0, 7);

function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** Everything the month calendar shows. Call after loadPlanner so the plan is fresh. */
export async function loadMonth(userId: string, now: number, requested?: string): Promise<MonthData> {
  const key = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : monthKeyOf(now);
  const first = parseLocal(`${key}-01T00:00`);
  const nextFirst = parseLocal(`${shiftMonth(key, 1)}-01T00:00`);
  const gridStart = first - dayOfWeek(first) * DAY;
  const weeks = Math.ceil((dayOfWeek(first) + (nextFirst - first) / DAY) / 7);
  const gridEnd = gridStart + weeks * 7 * DAY;
  const from = toSqlTimestamp(gridStart);
  const to = toSqlTimestamp(gridEnd);
  const db = sql();

  const [eventRows, taskRows, blockRows] = await Promise.all([
    db`
      SELECT id::text AS id, title, all_day, location, notes,
             to_char(start_at, 'YYYY-MM-DD HH24:MI') AS start, to_char(end_at, 'YYYY-MM-DD HH24:MI') AS end
      FROM events WHERE user_id = ${userId} AND end_at > ${from} AND start_at < ${to}
      ORDER BY start_at
    `,
    db`
      SELECT id::text AS id, title, notes, done_at IS NOT NULL AS done, to_char(due_at, 'YYYY-MM-DD HH24:MI') AS due
      FROM tasks WHERE user_id = ${userId} AND due_at >= ${from} AND due_at < ${to}
      ORDER BY due_at
    `,
    db`
      SELECT to_char(date_trunc('day', start_at), 'YYYY-MM-DD HH24:MI') AS day, status,
             SUM(EXTRACT(EPOCH FROM end_at - start_at) / 60)::int AS minutes
      FROM blocks
      WHERE user_id = ${userId} AND start_at >= ${from} AND start_at < ${to} AND status IN ('planned', 'done')
      GROUP BY 1, 2
    `,
  ]);

  const study: MonthData["study"] = {};
  for (const r of blockRows) {
    const d = ts(r.day);
    const entry = (study[d] ??= { planned: 0, done: 0 });
    if (r.status === "done") entry.done += r.minutes;
    else entry.planned += r.minutes;
  }

  return {
    key,
    first,
    gridStart,
    weeks,
    prevKey: shiftMonth(key, -1),
    nextKey: shiftMonth(key, 1),
    events: eventRows.map((r) => ({
      id: r.id,
      title: r.title,
      start: ts(r.start),
      end: ts(r.end),
      allDay: r.all_day,
      location: r.location,
      notes: r.notes,
    })),
    deadlines: taskRows.map((r) => ({ id: r.id, title: r.title, due: ts(r.due), done: r.done, notes: r.notes })),
    study,
  };
}

export async function getCommitments(userId: string): Promise<CommitmentRow[]> {
  const rows = await sql()`
    SELECT id::text AS id, title, day_of_week, start_min, end_min, notes
    FROM commitments WHERE user_id = ${userId}
    ORDER BY day_of_week, start_min
  `;
  return rows.map((r) => ({ id: r.id, title: r.title, day: r.day_of_week, start: r.start_min, end: r.end_min, notes: r.notes }));
}

/**
 * Rebuild the plan from scratch and return everything the planner page shows.
 * Runs on every visit, so the schedule is always current: missed sessions get
 * moved, finished work frees up time, and new tasks slot in.
 */
export async function loadPlanner(userId: string): Promise<PlannerData | null> {
  const prefs = await getPrefs(userId);
  if (!prefs) return null;

  const db = sql();
  const now = nowLocal(prefs.tz);
  const nowSql = toSqlTimestamp(now);

  const weekStart = startOfDay(now);

  const [commitments, taskRows, completedRows, historyRows, inProgressRows, eventRows] = await Promise.all([
    getCommitments(userId),
    db`
      SELECT t.id::text AS id, t.title, t.notes, to_char(t.due_at, 'YYYY-MM-DD HH24:MI') AS due,
             t.est_min, t.priority,
             COALESCE(SUM(EXTRACT(EPOCH FROM b.end_at - b.start_at) / 60) FILTER (WHERE b.status = 'done'), 0)::int AS done_min
      FROM tasks t LEFT JOIN blocks b ON b.task_id = t.id
      WHERE t.user_id = ${userId} AND t.done_at IS NULL
      GROUP BY t.id
      ORDER BY t.due_at
    `,
    db`
      SELECT est_min, actual_min FROM tasks
      WHERE user_id = ${userId} AND done_at IS NOT NULL AND actual_min IS NOT NULL
      ORDER BY done_at DESC LIMIT 20
    `,
    db`
      SELECT to_char(start_at, 'YYYY-MM-DD HH24:MI') AS start, status FROM blocks
      WHERE user_id = ${userId} AND status IN ('done', 'missed')
        AND start_at > ${nowSql}::timestamp - interval '60 days'
    `,
    // A session that's underway right now stays where it is.
    db`
      SELECT task_id::text AS task_id, to_char(start_at, 'YYYY-MM-DD HH24:MI') AS start,
             to_char(end_at, 'YYYY-MM-DD HH24:MI') AS end
      FROM blocks
      WHERE user_id = ${userId} AND status = 'planned' AND start_at < ${nowSql} AND end_at > ${nowSql}
    `,
    db`
      SELECT id::text AS id, title, all_day, location, notes,
             to_char(start_at, 'YYYY-MM-DD HH24:MI') AS start, to_char(end_at, 'YYYY-MM-DD HH24:MI') AS end
      FROM events
      WHERE user_id = ${userId} AND end_at > ${toSqlTimestamp(weekStart)}
        AND start_at < ${toSqlTimestamp(weekStart + PLAN_DAYS * DAY)}
      ORDER BY start_at
    `,
  ]);

  const events: EventView[] = eventRows.map((r) => ({
    id: r.id,
    title: r.title,
    start: ts(r.start),
    end: ts(r.end),
    allDay: r.all_day,
    location: r.location,
    notes: r.notes,
  }));

  const pace = learnPace(completedRows.map((r) => ({ est: r.est_min, actual: r.actual_min })));
  const focus = learnFocus(historyRows.map((r) => ({ start: ts(r.start), status: r.status })));
  const usedFocus = effectiveFocus(prefs.focus, focus);

  const inProgress = inProgressRows.map((r) => ({ taskId: r.task_id, start: ts(r.start), end: ts(r.end) }));

  const tasks = taskRows.map((r) => {
    const due = ts(r.due);
    const neededMin = roundUpTo(r.est_min * pace.multiplier, STEP);
    const underway = inProgress.filter((b) => b.taskId === r.id).reduce((n, b) => n + (b.end - b.start), 0);
    return {
      id: r.id as string,
      title: r.title as string,
      notes: (r.notes as string | null) ?? null,
      due,
      estMin: r.est_min as number,
      priority: r.priority as number,
      neededMin,
      doneMin: r.done_min as number,
      remaining: Math.max(0, neededMin - r.done_min - underway),
    };
  });

  const { blocks: planned, unscheduled } = buildSchedule({
    now,
    prefs,
    focus: usedFocus,
    commitments,
    // Timed events are busy time; all-day ones (birthdays, holidays) aren't.
    busy: [...inProgress, ...events.filter((e) => !e.allDay)],
    tasks: tasks.filter((t) => t.due > now).map((t) => ({ id: t.id, due: t.due, remaining: t.remaining, priority: t.priority })),
    days: PLAN_DAYS,
  });

  // Swap the future plan atomically. The advisory lock stops two tabs
  // re-planning at once from duplicating sessions.
  await db.transaction([
    db`SELECT pg_advisory_xact_lock(hashtext('plan:' || ${userId}::text))`,
    db`DELETE FROM blocks WHERE user_id = ${userId} AND status = 'planned' AND start_at >= ${nowSql}`,
    db`
      INSERT INTO blocks (user_id, task_id, start_at, end_at)
      SELECT ${userId}, t.task_id, t.start_at, t.end_at
      FROM unnest(${planned.map((b) => b.taskId)}::bigint[],
                  ${planned.map((b) => toSqlTimestamp(b.start))}::timestamp[],
                  ${planned.map((b) => toSqlTimestamp(b.end))}::timestamp[]) AS t(task_id, start_at, end_at)
    `,
  ]);

  const blockRows = await db`
    SELECT b.id::text AS id, b.task_id::text AS task_id, t.title,
           to_char(b.start_at, 'YYYY-MM-DD HH24:MI') AS start,
           to_char(b.end_at, 'YYYY-MM-DD HH24:MI') AS end, b.status
    FROM blocks b JOIN tasks t ON t.id = b.task_id
    WHERE b.user_id = ${userId}
      AND (
        (b.start_at >= ${toSqlTimestamp(weekStart)} AND b.start_at < ${toSqlTimestamp(weekStart + WEEK_DAYS * DAY)})
        OR (b.status = 'planned' AND b.end_at <= ${nowSql} AND t.done_at IS NULL)
      )
    ORDER BY b.start_at
  `;
  const blocks: BlockView[] = blockRows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    title: r.title,
    start: ts(r.start),
    end: ts(r.end),
    status: r.status,
  }));

  const [{ n: completedCount }] = await db`
    SELECT count(*)::int AS n FROM tasks WHERE user_id = ${userId} AND done_at IS NOT NULL
  `;

  return {
    now,
    prefs,
    commitments,
    events,
    tasks: tasks.map(({ remaining: _r, ...t }) => ({
      ...t,
      plannedMin: planned.filter((b) => b.taskId === t.id).reduce((n, b) => n + (b.end - b.start), 0),
      unscheduledMin: unscheduled[t.id] ?? 0,
      overdue: t.due <= now,
    })),
    blocks,
    pace,
    focus,
    usedFocus,
    completedCount,
  };
}
