import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { CHECKOUT_ENABLED, formatPrice, PLANS } from "@/lib/plans";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Upgrade to Premium · Selfwind Planner",
  description: `Selfwind Premium: unlimited assignments and more AI quick adds for ${formatPrice(PLANS.premium.priceUsd)} a month.`,
};

const { free, premium } = PLANS;
const price = formatPrice(premium.priceUsd);

const BENEFITS = [
  { title: "Plan every assignment", body: `No cap on how many assignments Selfwind schedules at once (Free plans ${free.taskLimit}).` },
  { title: `${premium.dailyQuickAdds} “Just type it” reads a day`, body: `Dump your whole week in plain English as often as you like (Free gets ${free.dailyQuickAdds}).` },
  { title: "Everything in Free", body: "Your week built automatically, re-planning when things slip, and learning your pace and focus time." },
];

const COMPARE: [string, string, string][] = [
  ["Week planned automatically", "✓", "✓"],
  ["Re-plans when sessions are missed", "✓", "✓"],
  ["Learns your pace and focus time", "✓", "✓"],
  ["Assignments planned at once", String(free.taskLimit), "Unlimited"],
  ["“Just type it” AI reads per day", String(free.dailyQuickAdds), String(premium.dailyQuickAdds)],
  ["Price", "$0", `${price} / ${premium.interval}`],
];

export default async function PremiumPage() {
  const user = await getCurrentUser();

  return (
    <>
      <SiteHeader />
      <main className="wrap checkout">
        {user && (
          <Link href="/planner" className="back-link">
            ← Back to your week
          </Link>
        )}
        <div className="checkout-grid">
          <section className="checkout-main">
            <span className="eyebrow">Upgrade</span>
            <h1>{premium.name}</h1>
            <p className="checkout-lead">
              For students with a full plate. Plan every class, job and assignment, not just the first {free.taskLimit}.
            </p>

            <ul className="benefits">
              {BENEFITS.map((b) => (
                <li key={b.title}>
                  <span className="check" aria-hidden="true">✓</span>
                  <div>
                    <strong>{b.title}</strong>
                    <p>{b.body}</p>
                  </div>
                </li>
              ))}
            </ul>

            <h2 className="compare-title">Free vs Premium</h2>
            <div className="compare-wrap">
              <table className="compare">
                <thead>
                  <tr>
                    <th scope="col"><span className="visually-hidden">Feature</span></th>
                    <th scope="col">Free</th>
                    <th scope="col" className="is-premium">Premium</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map(([feature, f, p]) => (
                    <tr key={feature}>
                      <th scope="row">{feature}</th>
                      <td>{f}</td>
                      <td className="is-premium">{p}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="panel order-card" aria-labelledby="order-title">
            <h2 id="order-title" className="panel-title">Order summary</h2>

            <div className="order-line">
              <div>
                <strong>{premium.name}</strong>
                <span className="muted small">Monthly plan · cancel anytime</span>
              </div>
              <span className="order-amount">{price}</span>
            </div>

            <div className="order-total">
              <span>Due today</span>
              <span>{price}</span>
            </div>
            <p className="hint">
              Then {price} every {premium.interval} until you cancel. Any sales tax is calculated at payment.
            </p>

            {!user ? (
              <div className="order-actions">
                <Link href="/signup" className="btn btn-primary btn-block">
                  Create an account to upgrade
                </Link>
                <p className="small muted center">
                  Already have one? <Link href="/login">Log in</Link>
                </p>
              </div>
            ) : user.hasPaid ? (
              <div className="order-actions">
                <p className="form-ok">You already have Premium. Thanks for supporting Selfwind!</p>
                <Link href="/planner" className="btn btn-ghost btn-block">
                  Back to your week
                </Link>
              </div>
            ) : (
              <div className="order-actions">
                <p className="small muted">
                  Upgrading <strong>{user.email}</strong>
                </p>
                {/* When CHECKOUT_ENABLED is on, this button starts a hosted checkout (see lib/plans.ts). */}
                <button className="btn btn-primary btn-block" type="button" disabled={!CHECKOUT_ENABLED}>
                  Continue to secure payment
                </button>
                {!CHECKOUT_ENABLED && (
                  <p className="coming-soon" role="status">
                    Payments aren&apos;t switched on yet, so you can&apos;t be charged. Premium checkout is coming soon.
                  </p>
                )}
              </div>
            )}

            <p className="secure-note">
              <span aria-hidden="true">🔒</span> Card details are entered on a secure payment page, never on Selfwind, so we
              never see your card number.
            </p>
          </aside>
        </div>
      </main>
    </>
  );
}
