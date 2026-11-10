import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import SiteHeader from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Sign up · Selfwind Planner" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/planner");
  return (
    <>
      <SiteHeader />
      <main className="wrap auth-page">
        <AuthForm mode="signup" />
      </main>
    </>
  );
}
