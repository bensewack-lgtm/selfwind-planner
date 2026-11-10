import "server-only";
import { sql } from "./db";
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
import { DAY, nowLocal, parseLocal, roundUpTo, startOfDay, toSqlTimestamp } from "./time";

export const FREE_TASK_LIMIT = 5;
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

export type CommitmentRow = Commitment & { id: string; title: string };

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
};

export type BlockView = {
  id: string;
  taskId: string;
  title: string;
  start: number;
  end: number;
  status: "planned" | "done" | "missed";
};

export type PlannerData = {
  now: number;
  prefs: PlannerPrefs;
  commitments: CommitmentRow[];
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

export async function getCommitments(userId: string): Promise<CommitmentRow[]> {
  const rows = await sql()`
    SELECT id::text AS id, title, day_of_week, start_min, end_min
    FROM commitments WHERE user_id = ${userId}
    ORDER BY day_of_week, start_min
  `;
  return rows.map((r) => ({ id: r.id, title: r.title, day: r.day_of_week, start: r.start_min, end: r.end_min }));
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

  const [commitments, taskRows, completedRows, historyRows, inProgressRows] = await Promise.all([
    getCommitments(userId),
    db`
      SELECT t.id::text AS id, t.title, to_char(t.due_at, 'YYYY-MM-DD HH24:MI') AS due,
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
  ]);

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
    busy: inProgress,
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

  const weekStart = startOfDay(now);
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
