"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addCommitment, addEvent, addTask, savePreferences, type FormState } from "@/app/actions/planner";

function Message({ state }: { state: FormState }) {
  if (state?.error) return <p className="form-error" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="form-ok" role="status">{state.ok}</p>;
  return null;
}

/** Resets a form after a successful submit, keeping the user's input on errors. */
function useResetOnSuccess(state: FormState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

/** Manual add: an event at an exact time, or an assignment Selfwind schedules work for. */
export function ManualAdd({ defaultDue, defaultDate }: { defaultDue: string; defaultDate: string }) {
  const [mode, setMode] = useState<"event" | "task">("event");
  return (
    <div className="manual-add">
      <div className="segmented" role="radiogroup" aria-label="What are you adding?">
        <button type="button" role="radio" aria-checked={mode === "event"} className={mode === "event" ? "on" : ""} onClick={() => setMode("event")}>
          Event
        </button>
        <button type="button" role="radio" aria-checked={mode === "task"} className={mode === "task" ? "on" : ""} onClick={() => setMode("task")}>
          Assignment
        </button>
      </div>
      <p className="hint mode-hint">
        {mode === "event"
          ? "Something at a set time, like an appointment, game or exam. It goes on your calendar exactly when you say."
          : "Work due by a deadline. Selfwind plans study sessions before it, and the deadline shows as a red “Due” marker."}
      </p>
      {mode === "event" ? <EventForm defaultDate={defaultDate} /> : <TaskForm defaultDue={defaultDue} />}
    </div>
  );
}

function EventForm({ defaultDate }: { defaultDate: string }) {
  const [state, action, pending] = useActionState(addEvent, undefined);
  const ref = useResetOnSuccess(state);
  const [allDay, setAllDay] = useState(false);
  return (
    <form ref={ref} action={action} className="stack-form">
      <label>
        Event
        <input name="title" placeholder="e.g. Dentist appointment" maxLength={120} required />
      </label>
      <label>
        Date
        <input name="date" type="date" defaultValue={defaultDate} required />
      </label>
      <label className="check-row">
        <input type="checkbox" name="allDay" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
        All day
      </label>
      {!allDay && (
        <div className="form-row">
          <label>
            Starts
            <input name="start" type="time" defaultValue="15:00" required />
          </label>
          <label>
            Ends
            <input name="end" type="time" defaultValue="16:00" />
          </label>
        </div>
      )}
      <label>
        Where <span className="hint">(optional)</span>
        <input name="location" placeholder="e.g. Rec Hall" maxLength={120} />
      </label>
      <Message state={state} />
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add event"}
      </button>
    </form>
  );
}

export function TaskForm({ defaultDue }: { defaultDue: string }) {
  const [state, action, pending] = useActionState(addTask, undefined);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="stack-form">
      <label>
        Assignment
        <input name="title" placeholder="e.g. History essay draft" maxLength={120} required />
      </label>
      <div className="form-row">
        <label>
          Due
          <input name="due" type="datetime-local" defaultValue={defaultDue} required />
        </label>
        <label className="narrow">
          Hours of work
          <input name="hours" type="number" min="0.25" max="100" step="0.25" defaultValue="2" required />
        </label>
      </div>
      <label>
        Priority
        <select name="priority" defaultValue="2">
          <option value="3">High</option>
          <option value="2">Normal</option>
          <option value="1">Low</option>
        </select>
      </label>
      <Message state={state} />
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Planning…" : "Add and plan it"}
      </button>
    </form>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CommitmentForm() {
  const [state, action, pending] = useActionState(addCommitment, undefined);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="stack-form">
      <label>
        What is it?
        <input name="title" placeholder="e.g. Biology lecture, Work shift, Practice" maxLength={80} required />
      </label>
      <fieldset className="day-picker">
        <legend>Which days?</legend>
        {DAYS.map((d, i) => (
          <label key={d} className="day-chip">
            <input type="checkbox" name="days" value={i} />
            <span>{d}</span>
          </label>
        ))}
      </fieldset>
      <div className="form-row">
        <label>
          Starts
          <input name="start" type="time" defaultValue="09:00" required />
        </label>
        <label>
          Ends
          <input name="end" type="time" defaultValue="10:15" required />
        </label>
      </div>
      <Message state={state} />
      <button className="btn btn-ghost" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add to my schedule"}
      </button>
    </form>
  );
}

export function PreferencesForm({
  initial,
  submitLabel,
}: {
  initial: { dayStart: string; dayEnd: string; focus: string; maxBlock: number; breakMin: number };
  submitLabel: string;
}) {
  const [state, action, pending] = useActionState(savePreferences, undefined);
  const [tz, setTz] = useState("");
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  return (
    <form action={action} className="stack-form">
      <input type="hidden" name="tz" value={tz} />
      <div className="form-row">
        <label>
          My day starts
          <input name="dayStart" type="time" defaultValue={initial.dayStart} required />
        </label>
        <label>
          and ends
          <input name="dayEnd" type="time" defaultValue={initial.dayEnd} required />
        </label>
      </div>
      <label>
        I focus best in the…
        <select name="focus" defaultValue={initial.focus}>
          <option value="any">Not sure yet (let Selfwind figure it out)</option>
          <option value="morning">Morning</option>
          <option value="afternoon">Afternoon</option>
          <option value="evening">Evening</option>
        </select>
      </label>
      <div className="form-row">
        <label>
          Longest study session
          <select name="maxBlock" defaultValue={String(initial.maxBlock)}>
            <option value="30">30 minutes</option>
            <option value="45">45 minutes</option>
            <option value="60">1 hour</option>
            <option value="90">1.5 hours</option>
            <option value="120">2 hours</option>
          </select>
        </label>
        <label>
          Break between sessions
          <select name="breakMin" defaultValue={String(initial.breakMin)}>
            <option value="0">None</option>
            <option value="5">5 minutes</option>
            <option value="10">10 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
          </select>
        </label>
      </div>
      {tz && <p className="hint">Time zone: {tz}</p>}
      <Message state={state} />
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Building your week…" : submitLabel}
      </button>
    </form>
  );
}
