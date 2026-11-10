// What the calendars hand to the detail window when an item is clicked.
// Plain data, so it can cross from server pages into client components.

export const MAX_NOTES = 2000;

export type CalItem =
  | { kind: "event"; id: string; title: string; start: number; end: number; allDay: boolean; location: string | null; notes: string | null }
  | {
      kind: "task";
      id: string;
      title: string;
      due: number | null; // null for a session of an assignment that's already finished
      notes: string | null;
      session?: { start: number; end: number; status: "planned" | "done" | "missed" }; // set when a study session was clicked
      done?: boolean;
    }
  | {
      kind: "commitment";
      id: string;
      title: string;
      days: number[];
      start: number; // minute of day
      end: number;
      notes: string | null;
      date: number; // the day that was clicked (local minutes, start of day)
      canceled: boolean; // that day is canceled
    };
