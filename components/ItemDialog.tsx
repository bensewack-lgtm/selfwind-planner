"use client";

import Link from "next/link";
import { createContext, useActionState, useCallback, useContext, useEffect, useRef, useState } from "react";
import { deleteEvent, deleteTask, restoreCommitmentDay, saveNotes, skipCommitmentDay } from "@/app/actions/planner";
import { MAX_NOTES, type CalItem } from "@/lib/calendar-items";
import { DAY_NAMES, formatClock, formatDay, formatDue, formatRange, toLocalString } from "@/lib/time";

const OpenItem = createContext<(item: CalItem) => void>(() => {});

/** Calendars call this to open the detail window for an item. */
export function useOpenItem() {
  return useContext(OpenItem);
}

const LONG_DAY: Intl.DateTimeFormatOptions = { weekday: "long", month: "short", day: "numeric" };

function describe(item: CalItem, now: number) {
  switch (item.kind) {
    case "event":
      return {
        label: "Event",
        when: item.allDay ? `${formatDay(item.start, LONG_DAY)} · All day` : `${formatDay(item.start, LONG_DAY)} · ${formatRange(item.start, item.end)}`,
        extra: item.location ? `Where: ${item.location}` : null,
        notesLabel: "Notes",
        placeholder: "e.g. bring insurance card, arrive 10 minutes early",
      };
    case "task":
      return item.session
        ? {
            label: "Study session",
            when: `${formatDay(item.session.start, LONG_DAY)} · ${formatRange(item.session.start, item.session.end)}`,
            extra: item.due === null ? `For “${item.title}” (finished)` : `For “${item.title}”, due ${formatDue(item.due, now)}`,
            notesLabel: "Notes for this assignment",
            placeholder: "e.g. chapters 4–6, use the rubric on Canvas, ask TA about question 3",
          }
        : {
            label: item.done ? "Assignment (finished)" : "Assignment due",
            when: item.due === null ? "Finished" : `Due ${formatDue(item.due, now)}`,
            extra: null,
            notesLabel: "Notes for this assignment",
            placeholder: "e.g. chapters 4–6, use the rubric on Canvas, ask TA about question 3",
          };
    case "commitment":
      return {
        label: item.canceled ? "Canceled this day" : "Class / routine",
        when: `${formatDay(item.date, LONG_DAY)} · ${formatClock(item.start)} – ${formatClock(item.end % 1440)}`,
        extra: `Every ${item.days.map((d) => DAY_NAMES[d]).join(", ")}`,
        notesLabel: "Notes for this class or commitment (shared across all its days)",
        placeholder: "e.g. room 105 Willard, professor's office hours Wed 2–3",
      };
  }
}

function NotesForm({ item, now, onDone }: { item: CalItem; now: number; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveNotes, undefined);
  const [text, setText] = useState(item.notes ?? "");
  const d = describe(item, now);

  /** Run a delete/cancel action from this form (after an optional confirm), then close. */
  const run = (fn: (fd: FormData) => Promise<void>, question?: string) => async (fd: FormData) => {
    if (question && !confirm(question)) return;
    await fn(fd);
    onDone();
  };

  useEffect(() => {
    if (state?.ok) {
      const t = setTimeout(onDone, 700);
      return () => clearTimeout(t);
    }
  }, [state, onDone]);

  return (
    <>
      <div className={`item-dialog-head kind-${item.kind}`}>
        <span className="item-kind">{d.label}</span>
        <h2 id="item-dialog-title">{item.title}</h2>
        <p className="item-when">{d.when}</p>
        {d.extra && <p className="item-extra">{d.extra}</p>}
      </div>

      <form action={action} className="item-notes-form">
        <input type="hidden" name="kind" value={item.kind} />
        <input type="hidden" name="id" value={item.id} />
        {item.kind === "commitment" && <input type="hidden" name="date" value={toLocalString(item.date).slice(0, 10)} />}
        <label htmlFor="item-notes">{d.notesLabel}</label>
        <textarea
          id="item-notes"
          name="notes"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={d.placeholder}
          maxLength={MAX_NOTES}
          rows={5}
          autoFocus
        />
        <div className="item-notes-meta">
          <span className="hint">
            {text.length > MAX_NOTES - 200 ? `${MAX_NOTES - text.length} characters left` : "Only you can see these."}
          </span>
        </div>
        {state?.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
        {state?.ok && (
          <p className="form-ok" role="status">
            {state.ok}
          </p>
        )}
        <div className="item-dialog-actions">
          {item.kind === "event" && (
            <button type="submit" formAction={run(deleteEvent, `Delete “${item.title}” from your calendar?`)} className="btn btn-text danger">
              Delete event
            </button>
          )}
          {item.kind === "task" && (
            <button
              type="submit"
              formAction={run(deleteTask, `Delete the assignment “${item.title}” and all its study sessions?`)}
              className="btn btn-text danger"
            >
              Delete assignment
            </button>
          )}
          {item.kind === "commitment" &&
            (item.canceled ? (
              <button type="submit" formAction={run(restoreCommitmentDay)} className="btn btn-text restore">
                Restore {formatDay(item.date, { weekday: "short", month: "short", day: "numeric" })}
              </button>
            ) : (
              <button
                type="submit"
                formAction={run(
                  skipCommitmentDay,
                  `Cancel “${item.title}” on ${formatDay(item.date, LONG_DAY)} only? It stays on every other week.`,
                )}
                className="btn btn-text danger"
              >
                Cancel this day only
              </button>
            ))}
          <button type="button" className="btn btn-ghost" onClick={onDone}>
            Close
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending || text.trim() === (item.notes ?? "").trim()}>
            {pending ? "Saving…" : "Save notes"}
          </button>
        </div>
        {item.kind === "commitment" && (
          <p className="hint">
            To drop it every week, remove it in <Link href="/planner/setup">Routine &amp; preferences</Link>.
          </p>
        )}
      </form>
    </>
  );
}

/** Wrap the calendars in this so clicking any item opens its details and notes. */
export default function ItemDialogProvider({ now, children }: { now: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [item, setItem] = useState<CalItem | null>(null);
  const [opened, setOpened] = useState(0); // fresh form state each time it opens

  const open = useCallback((next: CalItem) => {
    setItem(next);
    setOpened((n) => n + 1);
  }, []);
  const close = useCallback(() => ref.current?.close(), []);

  useEffect(() => {
    if (item && ref.current && !ref.current.open) ref.current.showModal();
  }, [item, opened]);

  return (
    <OpenItem.Provider value={open}>
      {children}
      <dialog
        ref={ref}
        className="item-dialog"
        aria-labelledby="item-dialog-title"
        onClose={() => setItem(null)}
        onClick={(e) => {
          if (e.target === ref.current) close(); // click on the backdrop
        }}
      >
        {item && <NotesForm key={opened} item={item} now={now} onDone={close} />}
      </dialog>
    </OpenItem.Provider>
  );
}

/** Small marker shown on calendar items that have notes. */
export function NotesMark({ notes }: { notes: string | null }) {
  if (!notes) return null;
  return (
    <span className="notes-mark" title="Has notes" aria-label="Has notes">
      ✎
    </span>
  );
}
