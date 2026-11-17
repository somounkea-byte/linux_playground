import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { firebaseClientConfig } from "@/server/config";
import { getSettings } from "@/server/services/settings";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage() {
  const settings = await getSettings();
  const firebase = firebaseClientConfig();
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mb-8 mt-1 text-sm text-muted-foreground">You will get your own Ubuntu machine to practise on – nothing to install.</p>
      {settings.registrationOpen ? (
        <Suspense>
          <AuthForm mode="register" firebase={firebase as never} demo={false} />
        </Suspense>
      ) : (
        <p className="rounded-lg border bg-muted/40 p-4 text-sm">Registration is currently closed. Please ask your teacher or administrator for an account.</p>
      )}
    </div>
  );
}
