import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions/auth";
import SiteHeader from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Your account · Selfwind Planner" };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <>
      <SiteHeader />
      <main className="wrap auth-page">
        <div className="auth-card">
          <h1>Your account</h1>
          <dl className="account-details">
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Plan</dt>
            <dd>
              {user.hasPaid ? (
                "Premium"
              ) : (
                <>
                  Free ·{" "}
                  <Link href="/premium" className="upgrade-link">
                    Upgrade to Premium
                  </Link>
                </>
              )}
            </dd>
          </dl>
          <div className="account-actions">
            <Link href="/planner" className="btn btn-primary">
              Open my planner
            </Link>
            <form action={logout}>
              <button className="btn btn-ghost" type="submit">
                Log out
              </button>
            </form>
          </div>
        </div>
      </main>
    </>
  );
}
