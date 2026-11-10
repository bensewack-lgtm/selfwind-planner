// Turns what the AI read out of a student's free text into calendar items we
// trust, and re-checks items coming back from the browser before saving.
// Pure functions: safe to use on the client and easy to test.

import { DAY, formatDay, formatDue, formatRange, formatClock, hhmmToMinutes, parseLocal, DAY_NAMES } from "./time";

/** What the model returns for each thing it found (all fields present, unused ones null). */
export type RawItem = {
  kind: "event" | "task" | "commitment";
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
export type QuickItem = EventItem | TaskItem | CommitmentItem;

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
export function normalizeItem(raw: RawItem, now: number): QuickItem | { problem: string } {
  const title = cleanTitle(raw.title);
  if (!title) return { problem: "Skipped something without a name." };

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
  }
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
