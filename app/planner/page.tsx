import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { completeTask, deleteEvent, deleteTask, setBlockStatus } from "@/app/actions/planner";
import { TaskForm } from "@/components/PlannerForms";
import QuickAdd from "@/components/QuickAdd";
import SiteHeader from "@/components/SiteHeader";
import WeekView from "@/components/WeekView";
import { FREE_TASK_LIMIT, loadPlanner, type PlannerData, type TaskView } from "@/lib/planner";
import { getCurrentUser } from "@/lib/session";
import { DAY, formatDay, formatDue, formatDuration, formatRange, startOfDay, toLocalString } from "@/lib/time";

export const metadata: Metadata = { title: "Your week · Selfwind Planner" };

const PERIOD_LABEL = { morning: "morning", afternoon: "afternoon", evening: "evening", any: "any time" } as const;

export default async function PlannerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const data = await loadPlanner(user.id);
  if (!data) redirect("/planner/setup");

  const { now, tasks, blocks } = data;
  const today = startOfDay(now);
  const weekPlanned = blocks.filter((b) => b.status === "planned" && b.start >= now && b.start < today + 7 * DAY);
  const plannedMin = weekPlanned.reduce((n, b) => n + (b.end - b.start), 0);
  const atRisk = tasks.filter((t) => t.unscheduledMin > 0 || t.overdue);
  // Default due date for the add form: two days from now at 11:59 PM.
  const defaultDue = toLocalString(today + 2 * DAY + 23 * 60 + 59);

  return (
    <>
      <SiteHeader />
      <main className="wrap-wide planner">
        <div className="planner-top">
          <div>
            <h1>Your week</h1>
            <p className="muted">
              Built automatically from your routine and deadlines. It rebuilds itself every time something changes.
            </p>
          </div>
          <div className="planner-top-actions">
            <span className={user.hasPaid ? "plan-pill paid" : "plan-pill"}>
              {user.hasPaid ? "Paid plan · unlimited" : `Free plan · ${tasks.length}/${FREE_TASK_LIMIT} assignments`}
            </span>
            <Link href="/planner/setup" className="btn btn-ghost">
              Routine &amp; preferences
            </Link>
          </div>
        </div>

        <QuickAdd />

        <Insights data={data} plannedMin={plannedMin} sessions={weekPlanned.length} atRisk={atRisk.length} />

        <div className="planner-grid">
          <section className="panel week-panel" aria-label="This week">
            {tasks.length === 0 && data.commitments.length === 0 && data.events.length === 0 ? (
              <EmptyWeek />
            ) : (
              <WeekView
                now={now}
                dayStart={data.prefs.dayStart}
                dayEnd={data.prefs.dayEnd}
                commitments={data.commitments}
                blocks={blocks}
                events={data.events}
              />
            )}
            <div className="legend">
              <span><i className="sw sw-fixed" />Classes &amp; commitments</span>
              <span><i className="sw sw-event" />Events</span>
              <span><i className="sw sw-task" />Study sessions</span>
              <span><i className="sw sw-done" />Done</span>
              <span><i className="sw sw-missed" />Missed (rescheduled)</span>
            </div>
          </section>

          <aside className="side">
            <TodayPanel data={data} />

            <EventsPanel data={data} />

            <section className="panel">
              <h2 className="panel-title">Add an assignment</h2>
              <TaskForm defaultDue={defaultDue} />
            </section>

            <section className="panel">
              <h2 className="panel-title">Assignments</h2>
              {tasks.length === 0 ? (
                <p className="muted small">Nothing yet. Add an assignment above and it&apos;ll be planned into your week.</p>
              ) : (
                <ul className="task-list">
                  {tasks.map((t) => (
                    <TaskItem key={t.id} task={t} now={now} />
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}

function Insights({ data, plannedMin, sessions, atRisk }: { data: PlannerData; plannedMin: number; sessions: number; atRisk: number }) {
  const { pace, focus, usedFocus, prefs } = data;
  const best = focus.period ? focus.rates[focus.period] : undefined;
  const pct = (n: number, d: number) => Math.round((n / d) * 100);

  return (
    <div className="insights">
      <div className="insight">
        <span className="insight-label">This week</span>
        <strong>{formatDuration(plannedMin)} planned</strong>
        <p>
          {sessions} study session{sessions === 1 ? "" : "s"} scheduled around your classes.
          {atRisk > 0 && <> <span className="warn-text">{atRisk} assignment{atRisk === 1 ? " needs" : "s need"} attention.</span></>}
        </p>
      </div>
      <div className="insight">
        <span className="insight-label">Learned: your pace</span>
        {pace.samples >= 2 ? (
          <>
            <strong>{pace.multiplier === 1 ? "Spot-on estimates" : `${pace.multiplier}× your estimates`}</strong>
            <p>
              {pace.multiplier > 1
                ? `Work usually takes you longer than you guess, so Selfwind plans ${pct(pace.multiplier - 1, 1)}% extra time.`
                : pace.multiplier < 1
                  ? `You usually finish faster than you guess, so Selfwind plans ${pct(1 - pace.multiplier, 1)}% less time.`
                  : "Your guesses match reality, so plans use them as-is."}
            </p>
          </>
        ) : (
          <>
            <strong>Still learning ({pace.samples}/2)</strong>
            <p>Finish assignments and say how long they really took. Selfwind will adjust future estimates.</p>
          </>
        )}
      </div>
      <div className="insight">
        <span className="insight-label">Learned: your focus time</span>
        {focus.period && best ? (
          <>
            <strong>{PERIOD_LABEL[focus.period][0].toUpperCase() + PERIOD_LABEL[focus.period].slice(1)}s</strong>
            <p>
              You finish {pct(best.done, best.total)}% of {focus.period} sessions, so it schedules {focus.period}s first
              {prefs.focus !== "any" && prefs.focus !== focus.period ? ` (instead of the ${prefs.focus}s you picked)` : ""}.
            </p>
          </>
        ) : (
          <>
            <strong>Still learning ({focus.samples}/6)</strong>
            <p>
              Mark sessions done or missed. For now it uses {usedFocus === "any" ? "the earliest free time" : `${PERIOD_LABEL[usedFocus]}s`}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function TodayPanel({ data }: { data: PlannerData }) {
  const { now, blocks } = data;
  const today = startOfDay(now);
  const unconfirmed = blocks.filter((b) => b.status === "planned" && b.end <= now && b.start < today);
  const todays = blocks.filter((b) => b.start >= today && b.start < today + DAY);
  const items = [...unconfirmed, ...todays];

  return (
    <section className="panel">
      <h2 className="panel-title">Today&apos;s sessions</h2>
      {items.length === 0 ? (
        <p className="muted small">Nothing scheduled today. Enjoy it, or add an assignment to get ahead.</p>
      ) : (
        <ul className="today-list">
          {items.map((b) => {
            const started = b.start <= now;
            return (
              <li key={b.id} className={`today-item ${b.status}`}>
                <div>
                  <span className="today-time">
                    {b.start < today ? `${b.start >= today - DAY ? "Yesterday" : formatDay(b.start)} · ` : ""}
                    {formatRange(b.start, b.end)}
                  </span>
                  <strong>{b.title}</strong>
                </div>
                {b.status === "done" && <span className="tag tag-done">Done</span>}
                {b.status === "missed" && <span className="tag tag-missed">Missed · moved</span>}
                {b.status === "planned" && !started && <span className="tag">Upcoming</span>}
                {b.status === "planned" && started && (
                  <div className="today-actions">
                    <span className="small muted">{b.end <= now ? "Did you do it?" : "In progress"}</span>
                    <form action={setBlockStatus}>
                      <input type="hidden" name="id" value={b.id} />
                      <input type="hidden" name="status" value="done" />
                      <button className="btn btn-sm btn-primary" type="submit">Done</button>
                    </form>
                    <form action={setBlockStatus}>
                      <input type="hidden" name="id" value={b.id} />
                      <input type="hidden" name="status" value="missed" />
                      <button className="btn btn-sm btn-ghost" type="submit">Missed</button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function EventsPanel({ data }: { data: PlannerData }) {
  const upcoming = data.events.filter((e) => e.end > data.now);
  if (upcoming.length === 0) return null;
  return (
    <section className="panel">
      <h2 className="panel-title">Coming up</h2>
      <ul className="event-list">
        {upcoming.map((e) => (
          <li key={e.id}>
            <div>
              <strong>{e.title}</strong>
              <span className="muted small">
                {formatDay(e.start)} · {e.allDay ? "All day" : formatRange(e.start, e.end)}
                {e.location ? ` · ${e.location}` : ""}
              </span>
            </div>
            <form action={deleteEvent}>
              <input type="hidden" name="id" value={e.id} />
              <button className="btn btn-sm btn-text" type="submit" aria-label={`Delete ${e.title}`}>
                Delete
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TaskItem({ task: t, now }: { task: TaskView; now: number }) {
  const progress = Math.min(100, Math.round((t.doneMin / Math.max(1, t.neededMin)) * 100));
  const priority = t.priority === 3 ? "High" : t.priority === 1 ? "Low" : null;
  const guess = (t.doneMin || t.estMin) / 60;

  return (
    <li className="task">
      <div className="task-head">
        <strong>{t.title}</strong>
        {priority && <span className={t.priority === 3 ? "tag tag-high" : "tag"}>{priority}</span>}
      </div>
      <div className="task-meta">
        <span>Due {formatDue(t.due, now)}</span>
        <span>
          {formatDuration(t.doneMin)} of {formatDuration(t.neededMin)} done
          {t.neededMin !== t.estMin && <> (you guessed {formatDuration(t.estMin)})</>}
        </span>
      </div>
      <div className="progress" aria-label={`${progress}% done`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      {t.overdue ? (
        <p className="warn">This was due {formatDue(t.due, now)}. Mark it finished or delete it.</p>
      ) : t.unscheduledMin > 0 ? (
        <p className="warn">
          {formatDuration(t.unscheduledMin)} won&apos;t fit before the deadline. Free up time in your routine or lower
          other priorities.
        </p>
      ) : (
        t.plannedMin > 0 && <p className="ok-text small">On track · {formatDuration(t.plannedMin)} scheduled</p>
      )}
      <div className="task-actions">
        <details>
          <summary className="btn btn-sm btn-ghost">Finished</summary>
          <form action={completeTask} className="finish-form">
            <input type="hidden" name="id" value={t.id} />
            <label>
              How many hours did it really take?
              <input name="actualHours" type="number" min="0.25" max="200" step="0.25" defaultValue={guess.toFixed(2).replace(/\.?0+$/, "")} />
            </label>
            <button className="btn btn-sm btn-primary" type="submit">Mark finished</button>
          </form>
        </details>
        <form action={deleteTask}>
          <input type="hidden" name="id" value={t.id} />
          <button className="btn btn-sm btn-text" type="submit">Delete</button>
        </form>
      </div>
    </li>
  );
}

function EmptyWeek() {
  return (
    <div className="empty-week">
      <h2>Your week is wide open</h2>
      <p className="muted">
        Add your classes and work in <Link href="/planner/setup">Routine &amp; preferences</Link>, then add an assignment.
        Selfwind will find the time for it.
      </p>
    </div>
  );
}
