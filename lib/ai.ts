import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  cancelContextText,
  dateContext,
  isProblem,
  MAX_ITEMS,
  normalizeItem,
  type CancelContext,
  type QuickItem,
  type RawItem,
} from "./quick-add";
import { parseWithRules } from "./rule-parser";

// Haiku: fast and very cheap (about $0.0007 per message), plenty for this.
const MODEL = "claude-haiku-5-5";

const ItemSchema = z.object({
  kind: z.enum(["event", "task", "commitment", "cancel"]),
  title: z.string(),
  date: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  days: z.array(z.number().int()).nullable(),
  due_date: z.string().nullable(),
  due_time: z.string().nullable(),
  estimate_hours: z.number().nullable(),
  priority: z.enum(["low", "normal", "high"]).nullable(),
  location: z.string().nullable(),
});

const ResultSchema = z.object({
  items: z.array(ItemSchema),
  unclear: z.string().nullable(),
});

// Kept identical on every request so it can be cached; anything that changes
// per request (the date, the student's text) goes in the user message.
const SYSTEM = `You turn a student's casual description of what's going on in their life into calendar items for a planner app.

Classify each thing into exactly one kind:
- "event": happens at a fixed date and time, once. Appointments, games, matches, meetings, parties, concerts, flights, exams and quizzes themselves, office hours on a specific day. Set date, and start and end if a time is given. Leave start and end null for all-day things like birthdays, holidays or trips without a time.
- "task": work the student needs to get done before a deadline, at a time of their choosing. Homework, essays, projects, readings, applications, studying. Set due_date and due_time (null due_time means end of day), estimate_hours, and priority.
- "commitment": repeats every week at the same times. Classes, a regular job shift, weekly practice, standing meetings. Set days (0 = Sunday, 1 = Monday, ..., 6 = Saturday) with start and end.
- "cancel": something the student already has is canceled or not happening ("no bio lecture tomorrow", "my shift Thursday got cancelled", "dentist is off"). Set title to the matching name EXACTLY as it appears in their routine or events list below, date to the day it's canceled (null if they don't say: the next time it happens), and start only if they name a time to tell two of the same thing apart. Leave the other fields null. Never use "cancel" for something that isn't in their routine or events.

Rules:
- Resolve relative dates ("tomorrow", "this Friday", "next Tuesday", "the 14th") using the calendar provided. "Next <weekday>" means the first such day after today unless that is tomorrow, in which case it means the one after. Never return a date in the past unless the student clearly says so.
- Times are 24-hour HH:MM. Interpret "3" or "at 3" in the afternoon/evening when that is the sensible reading for a student (3 -> 15:00, 9 -> 09:00 for classes, 21:00 for "9 tonight").
- If an event has a start time but no end, pick a sensible length (appointment 1h, class 1h15, game or match 2h, exam 2h, party 3h, shift as stated).
- For tasks without an estimate, give a realistic one for a college student (short worksheet 1h, problem set 3h, essay draft 5h, research paper 10h, reading 1.5h).
- When someone has an exam, test or quiz on a date, add the event AND a separate task to study for it, due at the exam's start time, unless they say they're already prepared. Study estimate: quiz 2h, test or exam 4h, midterm 6h, final 8h. Title it like "Study for <exam>".
- Priority: "high" if they say it's important, urgent, worth a lot, or a big exam; "low" if they say it's optional or minor; otherwise "normal".
- Titles: short and clear, in title case for names of things, like a real calendar entry ("Dentist appointment", "CHEM 110 problem set 7", "Study for BIOL midterm"). Drop filler words. Keep course codes as written.
- Put a location in location only if one is mentioned.
- Split a message into as many items as it contains. Don't invent things that weren't mentioned, apart from the study tasks described above.
- Fill every field; use null for fields that don't apply to that kind.
- If part of the message is too vague to place on a calendar (no day at all, for example), leave it out and briefly say what was unclear in "unclear" (one short sentence addressed to the student). Otherwise set "unclear" to null.`;

export type QuickAddSource = "ai" | "basic";

export function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Ask Claude Haiku. Returns null when the AI can't be used, so the caller falls back to the free parser. */
async function readWithAI(
  text: string,
  now: number,
  timeZone: string,
  ctx: CancelContext,
): Promise<{ items: RawItem[]; unclear: string | null } | null> {
  const client = new Anthropic({ timeout: 30_000, maxRetries: 1 });
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(ResultSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `${dateContext(now)}\nTime zone: ${timeZone}\n\n${cancelContextText(ctx, now)}\n\nThe student wrote:\n<message>\n${text}\n</message>`,
        },
      ],
    });
    // Haiku has no automatic fallback model, so a decline goes to the free parser.
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    return { items: response.parsed_output.items as RawItem[], unclear: response.parsed_output.unclear };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) console.error("quick add: ANTHROPIC_API_KEY was rejected");
    else if (error instanceof Anthropic.RateLimitError) console.warn("quick add: rate limited, using the basic parser");
    else if (error instanceof Anthropic.APIConnectionError) console.warn("quick add: couldn't reach the API, using the basic parser");
    else if (error instanceof Anthropic.APIError) console.error(`quick add: API error ${error.status}`);
    else console.error("quick add: unexpected error", error);
    return null;
  }
}

/**
 * Read a student's message. Uses Claude Haiku when `useAI` is true and a key
 * is configured; otherwise, or if the AI fails, the free rule-based parser.
 */
export async function readQuickAdd(
  text: string,
  now: number,
  timeZone: string,
  useAI: boolean,
  ctx: CancelContext,
): Promise<{ items: QuickItem[]; problems: string[]; source: QuickAddSource }> {
  let source: QuickAddSource = "basic";
  let result = useAI && aiAvailable() ? await readWithAI(text, now, timeZone, ctx) : null;
  if (result) source = "ai";
  else result = parseWithRules(text, now);

  const items: QuickItem[] = [];
  const problems: string[] = [];
  for (const raw of result.items.slice(0, MAX_ITEMS)) {
    const result = normalizeItem(raw as RawItem, now, ctx);
    if (isProblem(result)) problems.push(result.problem);
    else items.push(result);
  }
  if (result.items.length > MAX_ITEMS) problems.push(`Only the first ${MAX_ITEMS} things were kept. Add the rest in another message.`);
  if (result.unclear) problems.push(result.unclear);
  return { items, problems, source };
}
