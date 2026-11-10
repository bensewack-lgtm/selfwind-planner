// The planner works in the user's local wall-clock time. Internally a moment is
// a number of minutes since 1970-01-01 00:00 *local time* ("local minutes"),
// computed by treating the local date/time as if it were UTC. That keeps the
// math simple (no DST or offsets) while the server itself runs in UTC.

export const DAY = 1440;

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** "2026-11-10T14:30" or "2026-11-10 14:30[:00]" -> local minutes */
export function parseLocal(s: string): number {
  const iso = s.trim().replace(" ", "T").slice(0, 16);
  const ms = Date.parse(`${iso}:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Bad local time: ${s}`);
  return ms / 60000;
}

/** local minutes -> "2026-11-10T14:30" (also what <input type="datetime-local"> uses) */
export function toLocalString(lm: number): string {
  return new Date(lm * 60000).toISOString().slice(0, 16);
}

/** local minutes -> "2026-11-10 14:30", for SQL `timestamp` columns */
export function toSqlTimestamp(lm: number): string {
  return toLocalString(lm).replace("T", " ");
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The current local time in a time zone, in local minutes. */
export function nowLocal(tz: string, at: Date = new Date()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return parseLocal(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`);
}

export const startOfDay = (lm: number) => lm - mod(lm, DAY);
export const minuteOfDay = (lm: number) => mod(lm, DAY);
/** 0 = Sunday ... 6 = Saturday */
export const dayOfWeek = (lm: number) => new Date(lm * 60000).getUTCDay();

export const roundUpTo = (n: number, step: number) => Math.ceil(n / step) * step;

export function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export function minutesToHhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** 870 -> "2:30 PM" */
export function formatClock(minOfDay: number): string {
  const h24 = Math.floor(minOfDay / 60) % 24;
  const m = minOfDay % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
}

export function formatRange(start: number, end: number): string {
  return `${formatClock(minuteOfDay(start))} – ${formatClock(minuteOfDay(end))}`;
}

/** local minutes -> "Mon 11/10" */
export function formatDay(lm: number, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "numeric", day: "numeric" }): string {
  return new Date(lm * 60000).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}

/** 95 -> "1h 35m" */
export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Due-date label relative to now, e.g. "Today 5 PM", "Tomorrow 9 AM", "Thu 11/13 11:59 PM" */
export function formatDue(due: number, now: number): string {
  const days = (startOfDay(due) - startOfDay(now)) / DAY;
  const clock = formatClock(minuteOfDay(due));
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Tomorrow ${clock}`;
  return `${formatDay(due)} ${clock}`;
}

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
