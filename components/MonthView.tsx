"use client";

import Link from "next/link";
import { NotesMark, useOpenItem } from "@/components/ItemDialog";
import type { MonthData } from "@/lib/planner";
import { DAY, DAY_NAMES, formatClock, formatDay, formatDuration, minuteOfDay, startOfDay } from "@/lib/time";

export default function MonthView({ month, now }: { month: MonthData; now: number }) {
  const open = useOpenItem();
  const today = startOfDay(now);
  const firstDate = new Date(month.first * 60000);
  const isCurrent = month.key === new Date(today * 60000).toISOString().slice(0, 7);
  const cells = Array.from({ length: month.weeks * 7 }, (_, i) => month.gridStart + i * DAY);

  return (
    <section className="panel month-panel" aria-labelledby="month-title">
      <div className="month-head">
        <h2 id="month-title" className="panel-title">
          {firstDate.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" })}
        </h2>
        <nav className="month-nav" aria-label="Change month">
          <Link href={`/planner?month=${month.prevKey}#month-title`} scroll={false} className="btn btn-sm btn-ghost" aria-label="Previous month">
            ←
          </Link>
          {!isCurrent && (
            <Link href="/planner#month-title" scroll={false} className="btn btn-sm btn-ghost">
              This month
            </Link>
          )}
          <Link href={`/planner?month=${month.nextKey}#month-title`} scroll={false} className="btn btn-sm btn-ghost" aria-label="Next month">
            →
          </Link>
        </nav>
      </div>

      <div className="month-grid" role="grid" aria-labelledby="month-title">
        {DAY_NAMES.map((d) => (
          <div key={d} className="month-dow" role="columnheader">
            {d}
          </div>
        ))}
        {cells.map((d) => {
          const inMonth = new Date(d * 60000).toISOString().slice(0, 7) === month.key;
          const events = month.events.filter((e) => e.start < d + DAY && e.end > d);
          const deadlines = month.deadlines.filter((t) => startOfDay(t.due) === d);
          const study = month.study[d];
          const studyMin = study ? study.planned + study.done : 0;
          const classes = [
            "month-cell",
            inMonth ? "" : "outside",
            d === today ? "is-today" : "",
            d < today ? "past" : "",
          ].join(" ");
          return (
            <div key={d} className={classes} role="gridcell" aria-label={formatDay(d, { weekday: "long", month: "long", day: "numeric" })}>
              <span className="month-date">{new Date(d * 60000).getUTCDate()}</span>
              <div className="month-items">
                {events.map((e) => (
                  <button
                    key={`e${e.id}`}
                    type="button"
                    className="month-item m-event"
                    title={`${e.title}${e.allDay ? " · all day" : ` · ${formatClock(minuteOfDay(e.start))}`}${e.location ? ` · ${e.location}` : ""}`}
                    onClick={() =>
                      open({ kind: "event", id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, notes: e.notes })
                    }
                  >
                    {!e.allDay && e.start >= d && <span className="m-time">{formatClock(minuteOfDay(e.start)).replace(" ", "").toLowerCase()}</span>}
                    <span className="m-title">{e.title}</span>
                    <NotesMark notes={e.notes} />
                  </button>
                ))}
                {deadlines.map((t) => (
                  <button
                    key={`d${t.id}`}
                    type="button"
                    className={t.done ? "month-item m-due done" : "month-item m-due"}
                    title={`${t.title} ${t.done ? "(finished)" : `due ${formatClock(minuteOfDay(t.due))}`}`}
                    onClick={() => open({ kind: "task", id: t.id, title: t.title, due: t.due, notes: t.notes, done: t.done })}
                  >
                    <span className="m-time">Due</span>
                    <span className="m-title">{t.title}</span>
                    <NotesMark notes={t.notes} />
                  </button>
                ))}
                {studyMin > 0 && (
                  <span
                    className="month-study"
                    title={`${formatDuration(studyMin)} of study${study.done ? ` (${formatDuration(study.done)} done)` : ""}`}
                  >
                    {formatDuration(studyMin)} study
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="legend">
        <span><i className="sw sw-event" />Events</span>
        <span><i className="sw sw-due-solid" />Assignment due</span>
        <span><i className="sw sw-task" />Study time Selfwind planned</span>
        <span className="muted">Weekly classes appear on the week view above. Click anything for details and notes.</span>
      </div>
    </section>
  );
}
