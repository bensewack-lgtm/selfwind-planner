// The scheduling engine: given a student's routine, preferences and tasks,
// lay out work sessions before each deadline. Pure functions, no I/O.

import { DAY, dayOfWeek, minuteOfDay, roundUpTo, startOfDay } from "./time";

export type Focus = "any" | "morning" | "afternoon" | "evening";
export type Period = Exclude<Focus, "any">;

export type Interval = { start: number; end: number };

export type Prefs = {
  dayStart: number; // minute of day the student is available from
  dayEnd: number; // minute of day they stop
  maxBlock: number; // longest single work session, in minutes
  breakMin: number; // gap left after each session
};

export type Commitment = { day: number; start: number; end: number };

export type SchedTask = {
  id: string;
  due: number; // local minutes
  remaining: number; // minutes still to schedule
  priority: number; // 1 low, 2 normal, 3 high
};

export type PlannedBlock = { taskId: string; start: number; end: number };

export const STEP = 15;
export const MIN_BLOCK = 30;
const MAX_BLOCKS_PER_TASK_PER_DAY = 2;

export const PERIOD_WINDOWS: Record<Period, [number, number]> = {
  morning: [6 * 60, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 23 * 60],
};

export function periodOf(lm: number): Period {
  const m = minuteOfDay(lm);
  if (m < 12 * 60) return "morning";
  if (m < 17 * 60) return "afternoon";
  return "evening";
}

function subtract(free: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const f of free) {
    if (cut.end <= f.start || cut.start >= f.end) {
      out.push(f);
      continue;
    }
    if (cut.start > f.start) out.push({ start: f.start, end: cut.start });
    if (cut.end < f.end) out.push({ start: cut.end, end: f.end });
  }
  return out;
}

/** Open time from now until `days` days out: available hours minus commitments and busy blocks. */
export function freeTime(now: number, days: number, prefs: Prefs, commitments: Commitment[], busy: Interval[]): Interval[] {
  const today = startOfDay(now);
  let free: Interval[] = [];
  for (let d = 0; d < days; d++) {
    const base = today + d * DAY;
    free.push({ start: base + prefs.dayStart, end: base + prefs.dayEnd });
  }
  for (let d = 0; d < days; d++) {
    const base = today + d * DAY;
    const dow = dayOfWeek(base);
    for (const c of commitments) {
      if (c.day === dow) free = subtract(free, { start: base + c.start, end: base + c.end });
    }
  }
  for (const b of busy) free = subtract(free, b);
  free = subtract(free, { start: -Infinity, end: roundUpTo(now, STEP) });
  return free.filter((f) => f.end - f.start >= STEP);
}

/**
 * Earliest-deadline-first scheduling that spreads each task across days:
 * each pass gives a task at most one session per day, starting today, and
 * passes repeat until the task is fully scheduled or no time is left before
 * its deadline. Within a day, sessions go in the student's best focus window
 * when it has room.
 */
export function buildSchedule(input: {
  now: number;
  prefs: Prefs;
  focus: Focus;
  commitments: Commitment[];
  busy?: Interval[];
  tasks: SchedTask[];
  days?: number;
}): { blocks: PlannedBlock[]; unscheduled: Record<string, number> } {
  const { now, prefs, focus, commitments, tasks, busy = [], days = 14 } = input;
  let free = freeTime(now, days, prefs, commitments, busy);
  const today = startOfDay(now);
  const window = focus === "any" ? null : PERIOD_WINDOWS[focus];
  const blocks: PlannedBlock[] = [];
  const unscheduled: Record<string, number> = {};

  const order = [...tasks].sort((a, b) => a.due - b.due || b.priority - a.priority);

  for (const task of order) {
    let remaining = roundUpTo(Math.max(0, task.remaining), STEP);
    const perDay = new Map<number, number>();

    // First spread the work (a couple of sessions per day at most); if that
    // can't fit it before the deadline, drop the cap and use whatever is left.
    for (const cap of [MAX_BLOCKS_PER_TASK_PER_DAY, Infinity])
    while (remaining > 0) {
      let placedThisPass = false;

      for (let d = 0; d < days && remaining > 0; d++) {
        const base = today + d * DAY;
        if (base >= task.due) break;
        if ((perDay.get(d) ?? 0) >= cap) continue;

        const need = Math.min(remaining, MIN_BLOCK);
        let best: { start: number; end: number; score: number } | null = null;

        for (const f of free) {
          const s0 = Math.max(f.start, base);
          const e0 = Math.min(f.end, base + DAY, task.due);
          if (e0 - s0 < need) continue;

          let start = s0;
          let score = 1;
          if (window) {
            const ws = base + window[0];
            const we = base + window[1];
            if (Math.min(e0, we) - Math.max(s0, ws) >= need) {
              start = Math.max(s0, ws);
              score = 0;
            }
          }
          if (!best || score < best.score || (score === best.score && start < best.start)) {
            best = { start, end: e0, score };
          }
        }
        if (!best) continue;

        const gap = best.end - best.start;
        let len = Math.floor(Math.min(prefs.maxBlock, remaining, gap) / STEP) * STEP;
        // Don't leave a scrap too short to be a real session: finish the task
        // here if it fits (up to one step over the max), or shorten this
        // session so what's left is a full minimum session.
        const left = remaining - len;
        if (left > 0 && left < MIN_BLOCK) {
          if (remaining <= gap && remaining <= prefs.maxBlock + STEP) len = remaining;
          else if (len - (MIN_BLOCK - left) >= MIN_BLOCK) len -= MIN_BLOCK - left;
        }
        if (len < need) continue;

        blocks.push({ taskId: task.id, start: best.start, end: best.start + len });
        free = subtract(free, { start: best.start, end: best.start + len + prefs.breakMin });
        remaining -= len;
        perDay.set(d, (perDay.get(d) ?? 0) + 1);
        placedThisPass = true;
      }

      if (!placedThisPass) break;
    }

    if (remaining > 0) unscheduled[task.id] = remaining;
  }

  blocks.sort((a, b) => a.start - b.start);
  return { blocks, unscheduled };
}

// ---- Learning ----

export type FocusInsight = {
  period: Period | null; // best period, once there is enough history
  rates: Partial<Record<Period, { done: number; total: number }>>;
  samples: number;
};

/** Which time of day the student actually follows through on, from done/missed history. */
export function learnFocus(history: { start: number; status: "done" | "missed" }[], minSamples = 6): FocusInsight {
  const rates: FocusInsight["rates"] = {};
  for (const h of history) {
    const p = periodOf(h.start);
    const r = (rates[p] ??= { done: 0, total: 0 });
    r.total++;
    if (h.status === "done") r.done++;
  }
  const samples = history.length;
  let period: Period | null = null;
  if (samples >= minSamples) {
    let bestRate = -1;
    for (const [p, r] of Object.entries(rates) as [Period, { done: number; total: number }][]) {
      if (r.total < 3) continue;
      const rate = r.done / r.total;
      if (rate > bestRate) {
        bestRate = rate;
        period = p;
      }
    }
  }
  return { period, rates, samples };
}

export type PaceInsight = { multiplier: number; samples: number };

/** How long tasks really take compared with the student's estimates. */
export function learnPace(completed: { est: number; actual: number }[], minSamples = 2): PaceInsight {
  const usable = completed.filter((c) => c.est > 0 && c.actual > 0);
  if (usable.length < minSamples) return { multiplier: 1, samples: usable.length };
  const est = usable.reduce((s, c) => s + c.est, 0);
  const actual = usable.reduce((s, c) => s + c.actual, 0);
  const raw = Math.min(2.5, Math.max(0.5, actual / est));
  return { multiplier: Math.round(raw * 20) / 20, samples: usable.length };
}

/** The focus window the scheduler should use: learned behaviour wins once there's enough of it. */
export function effectiveFocus(preferred: Focus, learned: FocusInsight): Focus {
  return learned.period ?? preferred;
}
