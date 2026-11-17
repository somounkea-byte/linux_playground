import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { config, firebaseClientConfig } from "@/server/config";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  const firebase = firebaseClientConfig();
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mb-8 mt-1 text-sm text-muted-foreground">Sign in to continue to your Linux machine.</p>
      <Suspense>
        <AuthForm mode="login" firebase={firebase as never} demo={config().NODE_ENV !== "production" && !firebase} />
      </Suspense>
    </div>
  );
}
