import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { deleteCommitment } from "@/app/actions/planner";
import { CommitmentForm, PreferencesForm } from "@/components/PlannerForms";
import SiteHeader from "@/components/SiteHeader";
import { getCommitments, getPrefs } from "@/lib/planner";
import { getCurrentUser } from "@/lib/session";
import { DAY_NAMES, formatClock, minutesToHhmm } from "@/lib/time";

export const metadata: Metadata = { title: "Routine & preferences · Selfwind Planner" };

export default async function SetupPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [prefs, commitments] = await Promise.all([getPrefs(user.id), getCommitments(user.id)]);
  const firstTime = !prefs;

  // Group "Biology, 9:00–10:15" across days so it reads as one class.
  const groups = new Map<string, { title: string; start: number; end: number; days: { id: string; day: number }[] }>();
  for (const c of commitments) {
    const key = `${c.title}|${c.start}|${c.end}`;
    const g = groups.get(key) ?? { title: c.title, start: c.start, end: c.end, days: [] };
    g.days.push({ id: c.id, day: c.day });
    groups.set(key, g);
  }

  return (
    <>
      <SiteHeader />
      <main className="wrap setup">
        <div className="setup-head">
          <h1>{firstTime ? "Teach Selfwind your routine" : "Routine & preferences"}</h1>
          <p className="muted">
            {firstTime
              ? "Tell it once about the things that don't move, like classes and work. It plans your studying around them, every week."
              : "Changes here rebuild your plan straight away."}
          </p>
          {!firstTime && <Link href="/planner">← Back to your week</Link>}
        </div>

        <div className="setup-grid">
          <section className="panel">
            <h2 className="panel-title">
              <span className="step">1</span> Your fixed schedule
            </h2>
            <p className="muted small">Classes, work shifts, practice: anything that happens every week.</p>
            {groups.size > 0 && (
              <ul className="commitment-list">
                {[...groups.values()].map((g) => (
                  <li key={`${g.title}${g.start}${g.end}`}>
                    <div>
                      <strong>{g.title}</strong>
                      <span className="muted small">
                        {formatClock(g.start)} – {formatClock(g.end)}
                      </span>
                    </div>
                    <div className="chips">
                      {g.days.map((d) => (
                        <form key={d.id} action={deleteCommitment}>
                          <input type="hidden" name="id" value={d.id} />
                          <button className="chip" type="submit" title={`Remove ${g.title} on ${DAY_NAMES[d.day]}`}>
                            {DAY_NAMES[d.day]} <span aria-hidden="true">×</span>
                          </button>
                        </form>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <CommitmentForm />
          </section>

          <section className="panel">
            <h2 className="panel-title">
              <span className="step">2</span> How you like to work
            </h2>
            <p className="muted small">Your starting point. Selfwind adjusts as it learns how you actually work.</p>
            <PreferencesForm
              submitLabel={firstTime ? "Build my week →" : "Save and rebuild my week"}
              initial={{
                dayStart: minutesToHhmm(prefs?.dayStart ?? 8 * 60),
                dayEnd: minutesToHhmm(prefs?.dayEnd ?? 22 * 60),
                focus: prefs?.focus ?? "any",
                maxBlock: prefs?.maxBlock ?? 90,
                breakMin: prefs?.breakMin ?? 15,
              }}
            />
          </section>
        </div>
      </main>
    </>
  );
}
