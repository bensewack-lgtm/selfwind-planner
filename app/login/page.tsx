import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import SiteHeader from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Log in · Selfwind Planner" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/planner");
  return (
    <>
      <SiteHeader />
      <main className="wrap auth-page">
        <AuthForm mode="login" />
      </main>
    </>
  );
}
