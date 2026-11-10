// The free, no-AI reader for "Just type it". Uses chrono-node to find dates
// and times, plus keyword rules to decide what kind of thing each part is.
// It handles everyday phrasing ("dentist thursday at 3", "essay due friday",
// "I work tues and thurs 5-9") but not rambling or unusual wording.
// Produces the same RawItem shape as the AI, so validation is shared.

import * as chrono from "chrono-node";
import type { RawItem } from "./quick-add";

const DAY_WORDS: [RegExp, number][] = [
  [/\bsun(?:day)?s?\b/i, 0],
  [/\bmon(?:day)?s?\b/i, 1],
  [/\btue(?:s|sday)?s?\b/i, 2],
  [/\bwed(?:nesday)?s?\b/i, 3],
  [/\bthu(?:r|rs|rsday)?s?\b/i, 4],
  [/\bfri(?:day)?s?\b/i, 5],
  [/\bsat(?:urday)?s?\b/i, 6],
];
const DAY_ANY = /\b(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?s?\b/gi;
const DAY_GROUPS: [RegExp, number[]][] = [
  [/\bweekdays\b/i, [1, 2, 3, 4, 5]],
  [/\bweekends\b/i, [0, 6]],
  [/\bmwf\b/i, [1, 3, 5]],
  [/\b(?:tth|tuth|tr)\b/i, [2, 4]],
  [/\bmw\b/i, [1, 3]],
];

const RECURRING = /\b(?:every|each|weekly)\b|\b(?:sun|mon|tues|wednes|thurs|fri|satur)days\b|\b(?:mwf|tth|tuth|weekdays|weekends)\b/i;
const ROUTINE = /\b(?:i work|work(?:ing)?|shift|practice|class|classes|lecture|lab|rehearsal|meeting|club|gym)\b/i;
const SPECIFIC_DATE = /\b(?:next|this|tomorrow|today|tonight)\b|\b\d{1,2}\/\d{1,2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d/i;
const TASK = /\b(?:due|homework|hw|essay|paper|assignment|project|problem set|pset|p-set|worksheet|lab report|reading|readings|study|studying|application|draft|outline|webwork|discussion post|write[- ]?up)\b/i;
const EXAM = /\b(?:exam|test|quiz|midterm|final)\b/i;
const HIGH = /\b(?:important|urgent|big|huge|worth a lot|major|asap)\b/i;
const LOW = /\b(?:optional|minor|small|quick|if i have time)\b/i;
const RANGE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\b/i;
const HOURS = /(?:like|about|around|maybe|~)?\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i;
const MINUTES = /(?:like|about|around|maybe|~)?\s*(\d+)\s*(?:minutes?|mins?)\b/i;
const FILLER =
  /^(?:and|also|then|plus|oh|ugh|so|but|i have|i've got|ive got|i got|i need to|i have to|i gotta|need to|have to|gotta|don't forget|remember|there's|there is|finish|start|do|complete|work on|turn in|submit|my|a|an|the|i|it's|its|is|on|at|by|for|this|next|every|each|due)\b[\s,]*/i;
const TRAILING = /[\s,]*\b(?:is|are|due|on|at|by|for|this|next|every|each|and|from|in|the|a|it's|its|tonight|night|morning|afternoon|evening)\s*$/i;

function daysIn(text: string): number[] {
  const days = new Set<number>();
  for (const [re, ds] of DAY_GROUPS) if (re.test(text)) ds.forEach((d) => days.add(d));
  for (const [re, d] of DAY_WORDS) if (re.test(text)) days.add(d);
  return [...days].sort();
}

/** "5" with no am/pm, as a student would mean it: 1-7 is afternoon/evening, 8-12 is as written. */
function to24(h: number, m: number, mer: string | undefined): number {
  const p = mer?.toLowerCase();
  if (p?.startsWith("p") && h < 12) h += 12;
  else if (p?.startsWith("a") && h === 12) h = 0;
  else if (!p && h >= 1 && h <= 7) h += 12;
  return h * 60 + m;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function timeRange(text: string): { start: number; end: number; match: string } | null {
  const m = RANGE.exec(text);
  if (!m) return null;
  const endMer = m[6];
  // "3-5pm": the end's am/pm applies to the start too.
  const start = to24(Number(m[1]), Number(m[2] ?? 0), m[3] ?? endMer);
  let end = to24(Number(m[4]), Number(m[5] ?? 0), endMer);
  if (end <= start && !endMer) end += 12 * 60;
  return { start, end: Math.min(end, 1440), match: m[0] };
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function cleanTitle(text: string, remove: string[]): { title: string; location: string | null } {
  let t = text;
  let location: string | null = null;
  const loc = /\b(?:at|in)\s+((?:the\s+)?[A-Z][\w'&]*(?:\s+[A-Z0-9][\w'&]*)*)/.exec(t);
  if (loc && !/^(?:the\s+)?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Noon|Midnight|AM|PM)/.test(loc[1])) {
    location = loc[1].replace(/^the\s+/i, "");
    t = t.replace(loc[0], " ");
  }
  for (const r of remove) if (r) t = t.replace(r, " ");
  t = t
    .replace(DAY_ANY, " ")
    .replace(HOURS, " ")
    .replace(MINUTES, " ")
    .replace(/\b(?:it'?s|its) (?:a )?(?:big|huge|important|major|small|quick) (?:one|deal)\b/gi, " ")
    .replace(/\b(?:important|urgent|asap|optional)\b/gi, " ")
    .replace(/\b(?:at|@)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (let i = 0; i < 6; i++) t = t.replace(FILLER, "").replace(TRAILING, "").trim();
  t = t.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}')]+$/gu, "").trim();
  return { title: titleCase(t).slice(0, 120), location };
}

function splitClauses(text: string): string[] {
  const parts = text
    .replace(/\n+/g, ". ")
    .split(/(?<=[.!?;])\s+|\s*;\s*|,\s*(?:and\s+|then\s+|also\s+|plus\s+)*|\s+(?:and then|then|also|plus)\s+/i)
    .map((s) => s.trim().replace(/[.!?]+$/, ""))
    .filter(Boolean);
  // Re-join day lists that the comma split apart ("tuesday, thursday 5-9").
  const merged: string[] = [];
  for (const p of parts) {
    const onlyDays = p.replace(DAY_ANY, "").replace(/\b(?:and|&)\b/gi, "").trim() === "";
    if (onlyDays && merged.length) merged[merged.length - 1] += `, ${p}`;
    else merged.push(p);
  }
  // A day list followed by the rest ("tuesday, thursday 5-9" split the other way).
  const out: string[] = [];
  for (let i = 0; i < merged.length; i++) {
    const p = merged[i];
    const onlyDays = p.replace(DAY_ANY, "").replace(/\b(?:and|&|i work|work)\b/gi, "").trim() === "";
    if (onlyDays && merged[i + 1]) {
      merged[i + 1] = `${p} ${merged[i + 1]}`;
      continue;
    }
    out.push(p);
  }
  return out;
}

const blank = (): RawItem => ({
  kind: "event",
  title: "",
  date: null,
  start: null,
  end: null,
  days: null,
  due_date: null,
  due_time: null,
  estimate_hours: null,
  priority: null,
  location: null,
});

function defaultEstimate(text: string): number {
  if (/\b(?:research paper|term paper)\b/i.test(text)) return 10;
  if (/\bproject\b/i.test(text)) return 6;
  if (/\b(?:essay|paper|draft)\b/i.test(text)) return 5;
  if (/\blab report\b/i.test(text)) return 4;
  if (/\b(?:problem set|pset|p-set)\b/i.test(text)) return 3;
  if (/\breadings?\b/i.test(text)) return 1.5;
  if (/\b(?:worksheet|webwork|discussion post)\b/i.test(text)) return 1;
  return 2;
}

function studyHours(text: string): number {
  if (/\bfinal\b/i.test(text)) return 8;
  if (/\bmidterm\b/i.test(text)) return 6;
  if (/\b(?:exam|test)\b/i.test(text)) return 4;
  return 2; // quiz
}

/**
 * Parse free text into RawItems. `now` is local minutes; chrono is pointed at
 * a UTC clock showing the same wall time so its dates come out in local terms.
 */
export function parseWithRules(text: string, now: number): { items: RawItem[]; unclear: string | null } {
  const ref = { instant: new Date(now * 60000), timezone: 0 };
  const items: RawItem[] = [];
  const unclearBits: string[] = [];

  for (const clause of splitClauses(text)) {
    const days = daysIn(clause);
    // Hide time estimates ("3 hrs") from chrono, which would read them as "in 3 hours".
    const forDates = clause.replace(HOURS, " ").replace(MINUTES, " ");
    let hit: chrono.ParsedResult | undefined = chrono.parse(forDates, ref, { forwardDate: true })[0];
    if (!hit) {
      // "by the 20th": chrono needs a month, so use the next date with that day number.
      const ord = /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/i.exec(forDates);
      if (ord) {
        const today = new Date(now * 60000);
        for (let add = 0; add < 2; add++) {
          const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + add, Number(ord[1])));
          if (d.getUTCDate() === Number(ord[1]) && d.getTime() / 60000 >= now - (now % 1440)) {
            hit = chrono.parse(`${d.toISOString().slice(0, 10)}`, ref)[0];
            if (hit) (hit as { text: string }).text = ord[0];
            break;
          }
        }
      }
    }
    const range = timeRange(clause);
    const priority = HIGH.test(clause) ? "high" : LOW.test(clause) ? "low" : null;
    const hours = HOURS.exec(clause);
    const minutes = MINUTES.exec(clause);
    const estimate = hours ? Number(hours[1]) : minutes ? Number(minutes[1]) / 60 : null;

    // Weekly commitments: "every Monday", "tuesdays", "I work tues and thurs 5-9".
    const recurring = RECURRING.test(clause) || (ROUTINE.test(clause) && days.length >= 2 && !SPECIFIC_DATE.test(clause));
    if (recurring && days.length && !TASK.test(clause)) {
      const r = range ?? (hit?.start.isCertain("hour") ? { start: hit.start.get("hour")! * 60 + (hit.start.get("minute") ?? 0), end: NaN, match: hit.text } : null);
      const { title } = cleanTitle(clause, [r?.match ?? "", hit?.text ?? ""]);
      items.push({
        ...blank(),
        kind: "commitment",
        title: title || "Weekly commitment",
        days,
        start: r ? hhmm(r.start) : null,
        end: r && Number.isFinite(r.end) ? hhmm(r.end) : null,
      });
      continue;
    }

    // No date or day at all: probably extra detail for the previous item ("it's a big one", "maybe 5 hrs").
    if (!hit && !days.length) {
      const prev = items[items.length - 1];
      if (prev && (priority || estimate)) {
        if (priority && prev.kind === "task") prev.priority = priority;
        if (priority === "high") {
          const study = items.findLast((i) => i.kind === "task");
          if (study) study.priority = "high";
        }
        if (estimate && prev.kind === "task") prev.estimate_hours = estimate;
      } else if (clause.split(/\s+/).length > 1) {
        unclearBits.push(`“${clause}”`);
      }
      continue;
    }

    const when = hit?.start;
    const year = when?.get("year");
    const month = when?.get("month");
    const dayOfMonth = when?.get("day");
    const date = year && month && dayOfMonth ? `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}` : null;
    const hasTime = Boolean(when?.isCertain("hour")) || Boolean(range);
    let startMin: number | null = null;
    let endMin: number | null = null;
    if (range) {
      startMin = range.start;
      endMin = range.end;
    } else if (when?.isCertain("hour")) {
      const h = when.get("hour")!;
      const mi = when.get("minute") ?? 0;
      // "at 3" has no am/pm: read it the way a student means it (see to24).
      startMin = when.isCertain("meridiem") || h > 12 ? h * 60 + mi : to24(h, mi, undefined);
      if (hit?.end?.isCertain("hour")) endMin = hit.end.get("hour")! * 60 + (hit.end.get("minute") ?? 0);
    }

    const { title, location } = cleanTitle(clause, [hit?.text ?? "", range?.match ?? ""]);

    // Assignments: "essay due friday", "problem set 7 thursday".
    if (TASK.test(clause) && !(EXAM.test(clause) && !/\b(?:study|studying|review|prep)\b/i.test(clause))) {
      items.push({
        ...blank(),
        kind: "task",
        title: title || "Assignment",
        due_date: date,
        due_time: hasTime && startMin !== null ? hhmm(startMin) : null,
        estimate_hours: estimate ?? defaultEstimate(clause),
        priority,
      });
      continue;
    }

    // Everything else with a date is an event; exams also get a study task.
    const event: RawItem = {
      ...blank(),
      kind: "event",
      title: title || "Event",
      date,
      start: hasTime && startMin !== null ? hhmm(startMin) : null,
      end: hasTime && endMin !== null ? hhmm(endMin) : null,
      location,
    };
    items.push(event);
    if (EXAM.test(clause) && date) {
      items.push({
        ...blank(),
        kind: "task",
        title: `Study for ${event.title}`,
        due_date: date,
        due_time: event.start ?? "08:00", // no exam time given: be ready by the morning
        estimate_hours: estimate ?? studyHours(clause),
        priority: priority ?? (/\b(?:midterm|final)\b/i.test(clause) ? "high" : null),
      });
    }
  }

  return {
    items,
    unclear: unclearBits.length ? `Couldn't place ${unclearBits.join(", ")} on the calendar. Try adding a day.` : null,
  };
}
