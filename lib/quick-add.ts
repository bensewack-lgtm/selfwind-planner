// Turns what the AI read out of a student's free text into calendar items we
// trust, and re-checks items coming back from the browser before saving.
// Pure functions: safe to use on the client and easy to test.

import { DAY, dayOfWeek, formatDay, formatDue, formatRange, formatClock, hhmmToMinutes, parseLocal, startOfDay, DAY_NAMES } from "./time";

/** What the model returns for each thing it found (all fields present, unused ones null). */
export type RawItem = {
  kind: "event" | "task" | "commitment" | "cancel"; // cancel: title = what's canceled, date = which day
  title: string;
  date: string | null; // event: YYYY-MM-DD
  start: string | null; // event/commitment: HH:MM (24h)
  end: string | null; // event/commitment: HH:MM (24h)
  days: number[] | null; // commitment: 0 = Sunday ... 6 = Saturday
  due_date: string | null; // task: YYYY-MM-DD
  due_time: string | null; // task: HH:MM (24h)
  estimate_hours: number | null; // task
  priority: "low" | "normal" | "high" | null; // task
  location: string | null; // event
};

export type EventItem = { kind: "event"; title: string; start: number; end: number; allDay: boolean; location: string | null };
export type TaskItem = { kind: "task"; title: string; due: number; estMin: number; priority: number };
export type CommitmentItem = { kind: "commitment"; title: string; days: number[]; start: number; end: number };
/** Cancel one day of a class/commitment in the routine, or a one-off event. start/end are that occurrence's times. */
export type CancelItem = {
  kind: "cancel";
  target: "commitment" | "event";
  targetId: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
};
export type QuickItem = EventItem | TaskItem | CommitmentItem | CancelItem;

/** The student's routine and upcoming events, so a "canceled" message can be matched to the real thing. */
export type CancelContext = {
  commitments: { id: string; title: string; day: number; start: number; end: number }[];
  events: { id: string; title: string; start: number; end: number; allDay: boolean }[];
};

const STOP_WORDS = new Set(["the", "my", "a", "an", "class", "lecture", "is", "for", "and", "of", "on", "at", "to", "in", "today", "tomorrow"]);
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

/** Everyday words for the same thing ("my shift" = "Work: campus café"). */
const ALIASES: Record<string, string[]> = {
  shift: ["work", "job"],
  job: ["work", "shift"],
  work: ["shift", "job"],
  practice: ["training", "game"],
  game: ["match", "practice"],
  appt: ["appointment"],
  doctor: ["doctor's", "doctors", "dr"],
};

/** How well a name the student typed matches a title: exact > shared words (course numbers count double) > prefixes ("bio" ~ "BIOL"). */
export function matchScore(query: string, title: string): number {
  if (query.trim().toLowerCase() === title.trim().toLowerCase()) return 100;
  const titleWords = words(title);
  let score = 0;
  for (const q of words(query)) {
    const alts = [q, ...(ALIASES[q] ?? [])];
    for (const t of titleWords) {
      if (alts.slice(1).includes(t)) {
        score += 1;
        break;
      }
      if (q === t) {
        score += /\d/.test(q) ? 3 : 2;
        break;
      }
      if (q.length >= 3 && t.length >= 3 && (q.startsWith(t) || t.startsWith(q))) {
        score += 1;
        break;
      }
    }
  }
  return score;
}

const ROUTINE_WORDS = /\b(?:class|lecture|lab|recitation|seminar|practice|shift|work|club|meeting|rehearsal)\b/i;

/** Find what a "cancel" refers to: one day of a weekly commitment, or an upcoming event. */
export function resolveCancel(title: string, dayHint: number | null, timeHint: number | null, now: number, ctx: CancelContext): CancelItem | { problem: string } {
  const today = startOfDay(now);

  // Best-matching commitment title (rows for MWF classes share a title).
  let bestC = 0;
  for (const c of ctx.commitments) bestC = Math.max(bestC, matchScore(title, c.title));
  const cRows = bestC > 0 ? ctx.commitments.filter((c) => matchScore(title, c.title) === bestC) : [];

  let bestE = 0;
  for (const e of ctx.events) if (e.end > now) bestE = Math.max(bestE, matchScore(title, e.title));
  const eRows = bestE > 0 ? ctx.events.filter((e) => e.end > now && matchScore(title, e.title) === bestE) : [];

  const preferRoutine = cRows.length > 0 && (bestC > bestE || (bestC === bestE && (ROUTINE_WORDS.test(title) || eRows.length === 0)));

  if (preferRoutine) {
    const pick = (rows: typeof cRows) =>
      timeHint === null ? rows[0] : [...rows].sort((a, b) => Math.abs(a.start - timeHint) - Math.abs(b.start - timeHint))[0];
    if (dayHint !== null) {
      const row = pick(cRows.filter((c) => c.day === dayOfWeek(dayHint)));
      if (!row) {
        const days = [...new Set(cRows.map((c) => DAY_NAMES[c.day]))].join(", ");
        return { problem: `“${cRows[0].title}” doesn't meet on ${formatDay(dayHint, { weekday: "long" })} (it's on ${days}).` };
      }
      return { kind: "cancel", target: "commitment", targetId: row.id, title: row.title, start: dayHint + row.start, end: dayHint + row.end, allDay: false };
    }
    // No day given: the next time it meets.
    for (let k = 0; k < 8; k++) {
      const d = today + k * DAY;
      const row = pick(cRows.filter((c) => c.day === dayOfWeek(d) && d + c.end > now));
      if (row) return { kind: "cancel", target: "commitment", targetId: row.id, title: row.title, start: d + row.start, end: d + row.end, allDay: false };
    }
  }

  if (eRows.length) {
    const onDay = dayHint === null ? eRows : eRows.filter((e) => e.start < dayHint + DAY && e.end > dayHint);
    const ev = (onDay.length ? onDay : eRows).sort((a, b) => a.start - b.start)[0];
    return { kind: "cancel", target: "event", targetId: ev.id, title: ev.title, start: ev.start, end: ev.end, allDay: ev.allDay };
  }

  return { problem: `Couldn't find “${title}” in your routine or upcoming events to cancel.` };
}

export const MAX_INPUT_CHARS = 1500;
export const MAX_ITEMS = 15;
const DEFAULT_EVENT_MIN = 60;
const DEFAULT_TASK_MIN = 120;
const HORIZON_DAYS = 400;

const cleanTitle = (s: unknown) =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 120) : "";

function parseDate(s: string | null): number | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  try {
    return parseLocal(`${s}T00:00`);
  } catch {
    return null;
  }
}

function parseClock(s: string | null): number | null {
  if (!s) return null;
  const m = hhmmToMinutes(s);
  return m === null || m >= 1440 ? null : m;
}

/** Normalise one model item. Returns the item, or a reason it was dropped. */
export function normalizeItem(raw: RawItem, now: number, ctx?: CancelContext): QuickItem | { problem: string } {
  const title = cleanTitle(raw.title);
  if (!title) return { problem: "Skipped something without a name." };

  if (raw.kind === "cancel") {
    if (!ctx) return { problem: `Couldn't cancel “${title}”.` };
    const r = resolveCancel(title, parseDate(raw.date), parseClock(raw.start), now, ctx);
    return isProblem(r) ? r : validateItem(r, now);
  }

  if (raw.kind === "event") {
    const day = parseDate(raw.date);
    if (day === null) return { problem: `Couldn't tell what day “${title}” is.` };
    const startMin = parseClock(raw.start);
    if (startMin === null) {
      const item: EventItem = { kind: "event", title, start: day, end: day + DAY, allDay: true, location: cleanTitle(raw.location) || null };
      return validateItem(item, now);
    }
    let endMin = parseClock(raw.end);
    let end = endMin === null ? day + startMin + DEFAULT_EVENT_MIN : day + endMin;
    if (end <= day + startMin) end = endMin !== null && endMin < startMin ? day + DAY + endMin : day + startMin + DEFAULT_EVENT_MIN; // e.g. 10 PM - 1 AM
    const item: EventItem = { kind: "event", title, start: day + startMin, end, allDay: false, location: cleanTitle(raw.location) || null };
    return validateItem(item, now);
  }

  if (raw.kind === "task") {
    const day = parseDate(raw.due_date);
    if (day === null) return { problem: `Couldn't tell when “${title}” is due.` };
    const dueMin = parseClock(raw.due_time) ?? 23 * 60 + 59;
    const hours = typeof raw.estimate_hours === "number" && raw.estimate_hours > 0 ? raw.estimate_hours : DEFAULT_TASK_MIN / 60;
    const estMin = Math.round(Math.min(100, Math.max(0.25, hours)) * 4) * 15;
    const priority = raw.priority === "high" ? 3 : raw.priority === "low" ? 1 : 2;
    return validateItem({ kind: "task", title, due: day + dueMin, estMin, priority }, now);
  }

  if (raw.kind === "commitment") {
    const days = [...new Set((raw.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    const start = parseClock(raw.start);
    let end = parseClock(raw.end);
    if (start !== null && end === null) end = Math.min(1440, start + DEFAULT_EVENT_MIN);
    if (end === 0) end = 1440; // "until midnight"
    if (!days.length || start === null || end === null) return { problem: `Couldn't tell which days and times “${title}” happens.` };
    return validateItem({ kind: "commitment", title, days, start, end }, now);
  }

  return { problem: "Skipped something it couldn't classify." };
}

/** The checks every item must pass, whether it came from the model or back from the browser. */
export function validateItem(item: QuickItem, now: number): QuickItem | { problem: string } {
  const title = cleanTitle(item.title);
  if (!title) return { problem: "Skipped something without a name." };
  const finite = (...n: number[]) => n.every((x) => Number.isFinite(x) && Number.isInteger(x));

  switch (item.kind) {
    case "event": {
      if (!finite(item.start, item.end) || item.end <= item.start) return { problem: `“${title}” has an end time before its start.` };
      if (item.end - item.start > 7 * DAY) return { problem: `“${title}” is longer than a week, so it was skipped.` };
      if (item.end <= now) return { problem: `“${title}” is already over.` };
      if (item.start > now + HORIZON_DAYS * DAY) return { problem: `“${title}” is more than a year away.` };
      return { kind: "event", title, start: item.start, end: item.end, allDay: Boolean(item.allDay), location: cleanTitle(item.location) || null };
    }
    case "task": {
      if (!finite(item.due, item.estMin) || item.estMin < 15 || item.estMin > 6000) return { problem: `“${title}” needs a time estimate between 15 minutes and 100 hours.` };
      if (item.due <= now) return { problem: `“${title}” was due in the past.` };
      if (item.due > now + HORIZON_DAYS * DAY) return { problem: `“${title}” is due more than a year from now.` };
      const priority = [1, 2, 3].includes(item.priority) ? item.priority : 2;
      return { kind: "task", title, due: item.due, estMin: item.estMin, priority };
    }
    case "commitment": {
      const days = Array.isArray(item.days) ? [...new Set(item.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
      if (!days.length) return { problem: `“${title}” needs at least one day.` };
      if (!finite(item.start, item.end) || item.start < 0 || item.end > 1440 || item.end <= item.start) {
        return { problem: `“${title}” needs an end time after its start time on the same day.` };
      }
      return { kind: "commitment", title, days, start: item.start, end: item.end };
    }
    case "cancel": {
      // Ownership and that the class meets that day are re-checked against the database when saving.
      if (!["commitment", "event"].includes(item.target) || !/^\d+$/.test(String(item.targetId))) {
        return { problem: `Couldn't cancel “${title}”.` };
      }
      if (!finite(item.start, item.end) || item.end <= item.start) return { problem: `Couldn't cancel “${title}”.` };
      if (item.end <= now) return { problem: `“${title}” on ${formatDay(item.start)} is already over.` };
      return {
        kind: "cancel",
        target: item.target,
        targetId: String(item.targetId),
        title,
        start: item.start,
        end: item.end,
        allDay: Boolean(item.allDay),
      };
    }
    default:
      return { problem: "Skipped something it couldn't classify." };
  }
}

export function isProblem(x: QuickItem | { problem: string }): x is { problem: string } {
  return "problem" in x;
}

/** Human-readable "when" line for a preview card. */
export function describeWhen(item: QuickItem, now: number): string {
  switch (item.kind) {
    case "event": {
      if (item.allDay) return `${formatDay(item.start, { weekday: "long", month: "short", day: "numeric" })} · all day`;
      return `${formatDay(item.start, { weekday: "long", month: "short", day: "numeric" })} · ${formatRange(item.start, item.end)}`;
    }
    case "task":
      return `Due ${formatDue(item.due, now)}`;
    case "commitment":
      return `Every ${item.days.map((d) => DAY_NAMES[d]).join(", ")} · ${formatClock(item.start)} – ${formatClock(item.end % 1440)}`;
    case "cancel": {
      const day = formatDay(item.start, { weekday: "long", month: "short", day: "numeric" });
      const when = item.allDay ? `${day} · all day` : `${day} · ${formatRange(item.start, item.end)}`;
      return item.target === "commitment" ? `${when} · just this day` : `${when} · removed from your calendar`;
    }
  }
}

/** The routine and upcoming events as plain lines for the model, so it can name exactly what's canceled. */
export function cancelContextText(ctx: CancelContext, now: number): string {
  const groups = new Map<string, { title: string; start: number; end: number; days: number[] }>();
  for (const c of ctx.commitments) {
    const key = `${c.title}|${c.start}|${c.end}`;
    const g = groups.get(key) ?? { title: c.title, start: c.start, end: c.end, days: [] };
    g.days.push(c.day);
    groups.set(key, g);
  }
  const routine = [...groups.values()].map(
    (g) => `- ${g.title}: every ${g.days.sort().map((d) => DAY_NAMES[d]).join(", ")} ${formatClock(g.start)}-${formatClock(g.end % 1440)}`,
  );
  const events = ctx.events
    .filter((e) => e.end > now)
    .slice(0, 30)
    .map((e) => `- ${e.title}: ${new Date(e.start * 60000).toISOString().slice(0, 10)}${e.allDay ? " (all day)" : ` ${formatClock(e.start % DAY)}`}`);
  return `The student's weekly routine:\n${routine.join("\n") || "(none)"}\n\nTheir upcoming one-off events:\n${events.join("\n") || "(none)"}`;
}

/** Calendar context for the model: today's date plus the next two weeks spelled out, so it never has to do date math. */
export function dateContext(now: number): string {
  const today = now - (((now % DAY) + DAY) % DAY);
  const days = Array.from({ length: 15 }, (_, i) => {
    const d = today + i * DAY;
    const iso = new Date(d * 60000).toISOString().slice(0, 10);
    const label = i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : "";
    return `${formatDay(d, { weekday: "long" })} ${iso}${label}`;
  });
  const nowIso = new Date(now * 60000).toISOString().slice(0, 16).replace("T", " ");
  return `Current local date and time: ${nowIso} (${formatDay(now, { weekday: "long" })}).\nUpcoming dates:\n${days.join("\n")}`;
}
