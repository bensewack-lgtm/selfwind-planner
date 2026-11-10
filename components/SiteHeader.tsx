import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/session";

export default async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header>
      <div className="wrap">
        <Link href="/" className="logo">
          <span className="logo-mark" aria-hidden="true"></span>Selfwind Planner
        </Link>
        <nav className="nav">
          <span className="badge">In development</span>
          {user ? (
            <>
              <Link href="/planner" className="nav-link">
                Planner
              </Link>
              <Link href="/account" className="nav-link">
                Account
              </Link>
              <form action={logout}>
                <button className="btn btn-ghost nav-logout" type="submit">
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="nav-link">
                Log in
              </Link>
              <Link href="/signup" className="btn btn-primary">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
