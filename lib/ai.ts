import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { dateContext, isProblem, MAX_ITEMS, normalizeItem, type QuickItem, type RawItem } from "./quick-add";

const MODEL = "claude-opus-5-5";

const ItemSchema = z.object({
  kind: z.enum(["event", "task", "commitment"]),
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

export class QuickAddError extends Error {}

export async function readQuickAdd(text: string, now: number, timeZone: string): Promise<{ items: QuickItem[]; problems: string[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new QuickAddError("Quick add isn't switched on yet: the site is missing its ANTHROPIC_API_KEY.");
  }
  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });

  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(ResultSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `${dateContext(now)}\nTime zone: ${timeZone}\n\nThe student wrote:\n<message>\n${text}\n</message>`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new QuickAddError("Quick add's API key isn't valid. Check ANTHROPIC_API_KEY.");
    if (error instanceof Anthropic.RateLimitError) throw new QuickAddError("Quick add is busy right now. Try again in a minute.");
    if (error instanceof Anthropic.APIConnectionError) throw new QuickAddError("Couldn't reach the AI service. Try again in a moment.");
    if (error instanceof Anthropic.APIError) throw new QuickAddError("The AI service had a problem reading that. Try again.");
    throw error;
  }

  if (response.stop_reason === "refusal") {
    throw new QuickAddError("That message couldn't be processed. Try describing your plans differently.");
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new QuickAddError("Couldn't make sense of that. Try listing one thing per sentence with a day and time.");

  const items: QuickItem[] = [];
  const problems: string[] = [];
  for (const raw of parsed.items.slice(0, MAX_ITEMS)) {
    const result = normalizeItem(raw as RawItem, now);
    if (isProblem(result)) problems.push(result.problem);
    else items.push(result);
  }
  if (parsed.items.length > MAX_ITEMS) problems.push(`Only the first ${MAX_ITEMS} things were kept. Add the rest in another message.`);
  if (parsed.unclear) problems.push(parsed.unclear);
  return { items, problems };
}
