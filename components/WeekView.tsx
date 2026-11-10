import type { BlockView, CommitmentRow } from "@/lib/planner";
import { DAY, dayOfWeek, formatClock, formatDay, formatRange, minuteOfDay, startOfDay } from "@/lib/time";

const PX_PER_MIN = 0.8;

export default function WeekView({
  now,
  dayStart,
  dayEnd,
  commitments,
  blocks,
}: {
  now: number;
  dayStart: number;
  dayEnd: number;
  commitments: CommitmentRow[];
  blocks: BlockView[];
}) {
  const today = startOfDay(now);
  const days = Array.from({ length: 7 }, (_, i) => today + i * DAY);
  const weekBlocks = blocks.filter((b) => b.start >= today && b.start < today + 7 * DAY);

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
  from = Math.floor(from / 60) * 60;
  to = Math.min(1440, Math.ceil(to / 60) * 60);
  const height = (to - from) * PX_PER_MIN;
  const hours = Array.from({ length: (to - from) / 60 }, (_, i) => from + i * 60);
  const y = (min: number) => (min - from) * PX_PER_MIN;

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
                  .map((c) => (
                    <div
                      key={`c${c.id}`}
                      className="ev ev-fixed"
                      style={{ top: y(c.start), height: (c.end - c.start) * PX_PER_MIN }}
                      title={`${c.title} · ${formatClock(c.start)} – ${formatClock(c.end)}`}
                    >
                      <strong>{c.title}</strong>
                      <span>{formatClock(c.start)}</span>
                    </div>
                  ))}
                {weekBlocks
                  .filter((b) => startOfDay(b.start) === d)
                  .map((b) => {
                    const unconfirmed = b.status === "planned" && b.end <= now;
                    const cls = unconfirmed ? "unconfirmed" : b.status;
                    return (
                      <div
                        key={`b${b.id}`}
                        className={`ev ev-task ${cls}`}
                        style={{ top: y(minuteOfDay(b.start)), height: (b.end - b.start) * PX_PER_MIN }}
                        title={`${b.title} · ${formatRange(b.start, b.end)}${b.status !== "planned" ? ` · ${b.status}` : ""}`}
                      >
                        <strong>{b.title}</strong>
                        <span>{formatRange(b.start, b.end)}</span>
                      </div>
                    );
                  })}
                {i === 0 && nowY >= 0 && nowY <= height && <div className="now-line" style={{ top: nowY }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
