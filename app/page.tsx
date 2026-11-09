import SiteHeader from "@/components/SiteHeader";

const steps = [
  {
    title: "It learns your rhythm",
    body: "Tell it about your classes, work, and goals once. It picks up when you focus best and how long things really take.",
  },
  {
    title: "It builds your week",
    body: "It lays out a realistic schedule around your fixed commitments, with time blocked for the work that matters.",
  },
  {
    title: "It adapts as life happens",
    body: "When something moves or runs long, it reshuffles the rest of your plan for you instead of leaving you to fix it.",
  },
];

const audiences = [
  {
    icon: "⏱",
    title: "Busy students",
    body: "You're juggling classes, a job, practice, clubs, and a social life. You know what needs to get done; you just don't have hours every Sunday to map it all out. Selfwind Planner does the mapping so you can get on with the doing.",
  },
  {
    icon: "☐",
    title: "Students who struggle to stay organized",
    body: "If planners usually last about a week before you give up on them, this one is built for you. There's nothing to keep up with: no blank pages to fill in, no blocks to drag around. Your plan stays current even on the days you forget about it.",
  },
];

const reasons = [
  {
    title: "It gives you hours back every week",
    body: "Building and rebuilding a schedule by hand quietly eats a few hours each week. Selfwind Planner does it in the background, so that time goes back to studying, working, or resting.",
  },
  {
    title: "Fewer missed deadlines",
    body: "Dates pulled straight from your syllabus photos and lecture recordings land on your calendar automatically. Nothing gets lost in a notebook or a forgotten screenshot.",
  },
  {
    title: "It keeps working when you don't",
    body: "Free planners are only as good as your discipline. Selfwind Planner adjusts itself when your week changes, so one bad day doesn't wreck the whole plan.",
  },
  {
    title: "Less stress about what's next",
    body: "You always know what to work on right now, and that everything else has a slot. That peace of mind is the real product.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />

      <main>
        <div className="wrap hero">
          <h1>
            The planner that <em>builds itself.</em>
          </h1>
          <p>
            Selfwind Planner learns how you actually spend your time and turns it into a
            schedule for you. You stop rebuilding your calendar every week, and your plan
            keeps itself up to date.
          </p>
        </div>

        <section>
          <div className="wrap">
            <h2>What I&apos;m building</h2>
            <p className="lead">
              Most planners make you do all the work: typing in every task, dragging blocks
              around, and starting over when your week changes. Selfwind Planner is named
              after a self-winding watch, which keeps running from your everyday movement. It
              watches your routines, deadlines, and habits, then builds and adjusts your
              schedule automatically, so planning takes minutes instead of hours.
            </p>

            <div className="grid">
              {steps.map((s, i) => (
                <div className="card" key={s.title}>
                  <div className="step">{i + 1}</div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="wrap">
            <h2>Add events without typing</h2>
            <p className="lead">
              Getting dates into a calendar shouldn&apos;t mean typing them in by hand.
              Selfwind Planner will pull them straight from the videos and photos you already
              have.
            </p>

            <div className="grid">
              <div className="card">
                <div className="icon" aria-hidden="true">&#9654;</div>
                <h3>Upload a video</h3>
                <p>
                  Upload a video or recording, like a class lecture, a meeting, or a
                  coach&apos;s announcement. Selfwind Planner listens to the audio, picks out
                  any dates and times that are mentioned, and adds them to your calendar.
                </p>
              </div>
              <div className="card">
                <div className="icon" aria-hidden="true">&#9635;</div>
                <h3>Snap a photo</h3>
                <p>
                  Take a picture of a syllabus, flyer, whiteboard, or printed schedule.
                  Selfwind Planner reads the text in the photo, finds the dates and deadlines,
                  and adds them to your calendar for you.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="who-its-for">
          <div className="wrap">
            <h2>Who it&apos;s for</h2>
            <p className="lead">
              Selfwind Planner is made for students whose schedules move faster than they can
              keep up with by hand.
            </p>

            <div className="grid">
              {audiences.map((a) => (
                <div className="card" key={a.title}>
                  <div className="icon" aria-hidden="true">{a.icon}</div>
                  <h3>{a.title}</h3>
                  <p>{a.body}</p>
                </div>
              ))}
            </div>

            <h3 className="subhead">Why it&apos;s worth paying for</h3>
            <ul className="value">
              {reasons.map((r) => (
                <li key={r.title}>
                  <span className="check" aria-hidden="true">&#10003;</span>
                  <div>
                    <h4>{r.title}</h4>
                    <p>{r.body}</p>
                  </div>
                </li>
              ))}
            </ul>

            <p className="callout">
              <strong>Think of it this way:</strong> if it saves you even two hours a week,
              that&apos;s more than 30 hours back over a semester.
            </p>
          </div>
        </section>

        <section>
          <div className="wrap">
            <h2>Who&apos;s behind it</h2>
            <div className="creator">
              <div className="avatar" aria-hidden="true">BS</div>
              <div>
                <div className="name">Bennett Sewack</div>
                <div className="role">Founder and builder of Selfwind Planner</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">&copy; 2026 Bennett Sewack. Selfwind Planner is a work in progress.</div>
      </footer>
    </>
  );
}
