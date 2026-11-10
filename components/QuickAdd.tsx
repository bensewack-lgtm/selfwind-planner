"use client";

import { useActionState, useEffect, useState } from "react";
import { confirmQuickAdd, previewQuickAdd } from "@/app/actions/planner";
import { describeWhen, MAX_INPUT_CHARS, type QuickItem } from "@/lib/quick-add";
import { formatDuration } from "@/lib/time";

const EXAMPLES = [
  "Dentist Thursday at 3pm, then my history essay is due Friday night",
  "BIOL midterm next Wednesday at 10am, it's a big one",
  "I work at the campus café every Tuesday and Thursday 5 to 9",
  "Mom's birthday Saturday, and a basketball game Sunday at 7 in the rec center",
];

const KIND_LABEL: Record<QuickItem["kind"], string> = {
  event: "Event",
  task: "Assignment",
  commitment: "Every week",
};

export default function QuickAdd() {
  const [previewState, preview, reading] = useActionState(previewQuickAdd, undefined);
  const [confirmState, confirm, saving] = useActionState(confirmQuickAdd, undefined);
  const [text, setText] = useState("");
  const [kept, setKept] = useState<QuickItem[] | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // A new preview arrived: show its items.
  useEffect(() => {
    if (previewState?.stage === "preview") {
      setKept(previewState.items);
      setSaved(null);
    }
  }, [previewState]);

  // Saved: clear everything and say what happened.
  useEffect(() => {
    if (confirmState?.stage === "saved") {
      setSaved(confirmState.message);
      setKept(null);
      setText("");
    }
  }, [confirmState]);

  const showingPreview = kept !== null && previewState?.stage === "preview";
  const now = previewState?.stage === "preview" ? previewState.now : 0;

  return (
    <section className="panel quick-add" aria-labelledby="quick-add-title">
      <div className="quick-add-head">
        <h2 id="quick-add-title" className="panel-title">
          Just type it
        </h2>
        <p className="muted small">
          Write what&apos;s going on the way you&apos;d text a friend. Selfwind turns it into events, assignments and weekly
          plans.
        </p>
      </div>

      {!showingPreview && (
        <form
          action={(fd) => {
            setSaved(null);
            preview(fd);
          }}
          className="quick-add-form"
        >
          <textarea
            name="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
            }}
            placeholder="e.g. dentist thursday at 3, bio midterm next wednesday 10am, essay due friday night, I work tues and thurs 5-9"
            maxLength={MAX_INPUT_CHARS}
            rows={3}
            aria-label="Describe what you have going on"
            disabled={reading}
          />
          {!text && (
            <div className="examples" aria-label="Examples">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="example" onClick={() => setText(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          )}
          <div className="quick-add-actions">
            {previewState?.stage === "error" && !saved && (
              <p className="form-error" role="alert">
                {previewState.error}
              </p>
            )}
            {saved && (
              <p className="form-ok" role="status">
                {saved}
              </p>
            )}
            <button className="btn btn-primary" type="submit" disabled={reading || !text.trim()}>
              {reading ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Reading it…
                </>
              ) : (
                "Add to my calendar"
              )}
            </button>
          </div>
        </form>
      )}

      {showingPreview && (
        <div className="quick-preview">
          <p className="small">
            <strong>Here&apos;s what I found.</strong> Remove anything that&apos;s wrong, then add it.
            {previewState.source === "basic" && (
              <span className="muted"> (Read with the basic reader. Simple phrasing like “dentist Thursday at 3” works best.)</span>
            )}
          </p>
          <ul className="preview-list">
            {kept.map((item, i) => (
              <li key={`${item.kind}-${item.title}-${i}`} className={`preview-card kind-${item.kind}`}>
                <span className="preview-kind">{KIND_LABEL[item.kind]}</span>
                <div className="preview-body">
                  <strong>{item.title}</strong>
                  <span>{describeWhen(item, now)}</span>
                  {item.kind === "task" && (
                    <span className="muted">
                      About {formatDuration(item.estMin)} of work{item.priority === 3 ? " · high priority" : ""}. Selfwind
                      will schedule it.
                    </span>
                  )}
                  {item.kind === "event" && item.location && <span className="muted">{item.location}</span>}
                </div>
                <button
                  type="button"
                  className="preview-remove"
                  aria-label={`Remove ${item.title}`}
                  onClick={() => setKept(kept.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {previewState.problems.length > 0 && (
            <ul className="preview-problems">
              {previewState.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {confirmState?.stage === "error" && (
            <p className="form-error" role="alert">
              {confirmState.error}
            </p>
          )}
          <form action={confirm} className="quick-add-actions">
            <input type="hidden" name="items" value={JSON.stringify(kept)} />
            <button type="button" className="btn btn-ghost" onClick={() => setKept(null)} disabled={saving}>
              Edit text
            </button>
            <button className="btn btn-primary" type="submit" disabled={saving || kept.length === 0}>
              {saving ? "Adding…" : kept.length === 0 ? "Nothing to add" : `Add ${kept.length} to my calendar`}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
