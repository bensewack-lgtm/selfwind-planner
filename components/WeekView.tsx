"use client";

import { NotesMark, useOpenItem } from "@/components/ItemDialog";
import type { BlockView, CommitmentRow, EventView } from "@/lib/planner";
import { skipKey } from "@/lib/scheduler";
import { DAY, dayOfWeek, formatClock, formatDay, formatDue, formatRange, minuteOfDay, startOfDay } from "@/lib/time";

type Deadline = { id: string; title: string; due: number; notes: string | null };

const PX_PER_MIN = 1.1; // 66px per hour: room for a two-line title on a 30-minute item
const LINE = 14.5; // px per line of item text

/** How many lines of title fit in an item this tall, and whether the time line fits too. */
function fit(heightPx: number) {
  const lines = Math.max(1, Math.floor((heightPx - 4) / LINE + 0.02)); // 4px = top + bottom padding
  const showTime = lines >= 3;
  return { showTime, style: { ["--clamp" as string]: String(showTime ? lines - 1 : lines) } };
}

export default function WeekView({
  now,
  dayStart,
  dayEnd,
  commitments,
  blocks,
  events,
  deadlines,
  skips,
}: {
  now: number;
  dayStart: number;
  dayEnd: number;
  commitments: CommitmentRow[];
  blocks: BlockView[];
  events: EventView[];
  deadlines: Deadline[];
  skips: string[];
}) {
  const open = useOpenItem();
  const skipped = new Set(skips);
  const taskById = new Map(deadlines.map((d) => [d.id, d]));
  const today = startOfDay(now);
  const days = Array.from({ length: 7 }, (_, i) => today + i * DAY);
  const weekBlocks = blocks.filter((b) => b.start >= today && b.start < today + 7 * DAY);

  // Timed events are drawn per day (split at midnight); all-day ones go in the strip under the dates.
  const allDayFor = (d: number) => events.filter((e) => e.allDay && e.start < d + DAY && e.end > d);
  const timedFor = (d: number) =>
    events
      .filter((e) => !e.allDay && e.start < d + DAY && e.end > d)
      .map((e) => ({ ...e, segStart: Math.max(e.start, d), segEnd: Math.min(e.end, d + DAY) }));
  const hasAllDay = days.some((d) => allDayFor(d).length > 0);

  // Show the student's day, stretched to fit anything scheduled outside it.
  let from = dayStart;
  let to = dayEnd;
  for (const c of commitments) {
    from = Math.min(from, c.start);
    to = Math.max(to, c.end);
  }
  for (const b of weekBlocks) {
    from = Math.min(from, minuteOfDay(b.start));
    to = Math.max(to, minuteOfDay(b.start) + (b.end - b.start));
  }
  for (const d of days) {
    for (const e of timedFor(d)) {
      from = Math.min(from, e.segStart - d);
      to = Math.max(to, e.segEnd - d);
    }
  }
  const weekDeadlines = deadlines.filter((t) => t.due >= today && t.due < today + 7 * DAY);
  for (const t of weekDeadlines) {
    from = Math.min(from, minuteOfDay(t.due));
    to = Math.max(to, minuteOfDay(t.due) + 1);
  }
  from = Math.floor(from / 60) * 60;
  to = Math.min(1440, Math.ceil(to / 60) * 60);
  const height = (to - from) * PX_PER_MIN;
  const hours = Array.from({ length: (to - from) / 60 }, (_, i) => from + i * 60);
  const y = (min: number) => (min - from) * PX_PER_MIN;

  const openEvent = (e: EventView) =>
    open({ kind: "event", id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, notes: e.notes });

  return (
    <div className="week-scroll">
      <div className="week" style={{ ["--hour" as string]: `${60 * PX_PER_MIN}px` }}>
        <div className="week-head">
          <div />
          {days.map((d, i) => (
            <div key={d} className={i === 0 ? "day-head is-today" : "day-head"}>
              <span>{i === 0 ? "Today" : formatDay(d, { weekday: "short" })}</span>
              <small>{formatDay(d, { month: "numeric", day: "numeric" })}</small>
            </div>
          ))}
        </div>
        {hasAllDay && (
          <div className="week-allday">
            <div className="allday-label">All day</div>
            {days.map((d) => (
              <div key={d} className="allday-cell">
                {allDayFor(d).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="allday-chip"
                    title={e.location ? `${e.title} · ${e.location}` : e.title}
                    onClick={() => openEvent(e)}
                  >
                    {e.title}
                    <NotesMark notes={e.notes} />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="week-body" style={{ height }}>
          <div className="hour-labels">
            {hours.map((h) => (
              <span key={h} style={{ top: y(h) }}>
                {formatClock(h)}
              </span>
            ))}
          </div>
          {days.map((d, i) => {
            const dow = dayOfWeek(d);
            const nowY = y(minuteOfDay(now));
            return (
              <div key={d} className={i === 0 ? "day-col is-today" : "day-col"}>
                {commitments
                  .filter((c) => c.day === dow)
                  .map((c) => {
                    const canceled = skipped.has(skipKey(c.id, d));
                    const h = (c.end - c.start) * PX_PER_MIN;
                    const f = fit(h);
                    return (
                      <button
                        key={`c${c.id}`}
                        type="button"
                        className={canceled ? "ev ev-fixed canceled" : "ev ev-fixed"}
                        style={{ top: y(c.start), height: h, ...f.style }}
                        title={`${c.title} · ${formatClock(c.start)} – ${formatClock(c.end % 1440)}${canceled ? " · canceled this day" : ""}`}
                        onClick={() =>
                          open({
                            kind: "commitment",
                            id: c.id,
                            title: c.title,
                            // Notes are shared by every day this class meets, so show them all.
                            days: commitments.filter((o) => o.title === c.title && o.start === c.start && o.end === c.end).map((o) => o.day),
                            start: c.start,
                            end: c.end,
                            notes: c.notes,
                            date: d,
                            canceled,
                          })
                        }
                      >
                        <strong>
                          {canceled && <em className="canceled-tag">Canceled </em>}
                          {c.title}
                          <NotesMark notes={c.notes} />
                        </strong>
                        {f.showTime && <span>{formatClock(c.start)}</span>}
                      </button>
                    );
                  })}
                {timedFor(d).map((e) => {
                  const h = Math.max(20, (e.segEnd - e.segStart) * PX_PER_MIN);
                  const f = fit(h);
                  return (
                    <button
                      key={`e${e.id}`}
                      type="button"
                      className="ev ev-event"
                      style={{ top: y(e.segStart - d), height: h, ...f.style }}
                      title={`${e.title} · ${formatRange(e.start, e.end)}${e.location ? ` · ${e.location}` : ""}`}
                      onClick={() => openEvent(e)}
                    >
                      <strong>
                        {e.title}
                        <NotesMark notes={e.notes} />
                      </strong>
                      {f.showTime && (
                        <span>
                          {formatClock(minuteOfDay(e.start))}
                          {e.location ? ` · ${e.location}` : ""}
                        </span>
                      )}
                    </button>
                  );
                })}
                {weekBlocks
                  .filter((b) => startOfDay(b.start) === d)
                  .map((b) => {
                    const unconfirmed = b.status === "planned" && b.end <= now;
                    const cls = unconfirmed ? "unconfirmed" : b.status;
                    const task = taskById.get(b.taskId);
                    const h = (b.end - b.start) * PX_PER_MIN;
                    const f = fit(h);
                    return (
                      <button
                        key={`b${b.id}`}
                        type="button"
                        className={`ev ev-task ${cls}`}
                        style={{ top: y(minuteOfDay(b.start)), height: h, ...f.style }}
                        title={`Work session: ${b.title} · ${formatRange(b.start, b.end)}${
                          task ? ` · due ${formatDue(task.due, now)}` : ""
                        }${b.status !== "planned" ? ` · ${b.status}` : ""}`}
                        onClick={() =>
                          open({
                            kind: "task",
                            id: b.taskId,
                            title: b.title,
                            due: task?.due ?? null,
                            notes: task?.notes ?? null,
                            session: { start: b.start, end: b.end, status: b.status },
                          })
                        }
                      >
                        <strong>
                          {b.title}
                          <NotesMark notes={task?.notes ?? null} />
                        </strong>
                        {f.showTime && <span>{formatRange(b.start, b.end)}</span>}
                      </button>
                    );
                  })}
                {weekDeadlines
                  .filter((t) => startOfDay(t.due) === d)
                  .map((t) => (
                    <div key={`d${t.id}`} className="due-marker" style={{ top: y(minuteOfDay(t.due)) }}>
                      <button
                        type="button"
                        title={`${t.title} is due ${formatClock(minuteOfDay(t.due))}`}
                        onClick={() => open({ kind: "task", id: t.id, title: t.title, due: t.due, notes: t.notes })}
                      >
                        Due {formatClock(minuteOfDay(t.due))}: {t.title}
                        <NotesMark notes={t.notes} />
                      </button>
                    </div>
                  ))}
                {i === 0 && nowY >= 0 && nowY <= height && <div className="now-line" style={{ top: nowY }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
