"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { createClient } from "@/lib/supabase/client";

const authMode = process.env.NEXT_PUBLIC_CANTE_AUTH_MODE === "supabase" ? "supabase" : "demo";

function safeNext(rawNext: string | null) {
  if (!rawNext || !rawNext.startsWith("/") || rawNext.startsWith("//")) {
    return "/chat?country=Indonesia";
  }
  return rawNext;
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    if (authMode === "supabase") {
      try {
        const supabase = createClient();
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: username,
          password,
        });

        if (signInError) {
          setIsSubmitting(false);
          setError(signInError.message);
          return;
        }
      } catch (supabaseError) {
        setIsSubmitting(false);
        setError(
          supabaseError instanceof Error
            ? supabaseError.message
            : "Supabase login is not configured.",
        );
        return;
      }
    } else {
      const response = await fetch("/api/demo-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        setIsSubmitting(false);
        setError("Use the pilot credentials for PT MA.");
        return;
      }
    }

    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    router.push(next);
  }

  return (
    <main className="login-page">
      <header className="login-header">
        <Link className="login-wordmark" href="/" aria-label="Cante home">
          <BrandMark />
          <span>Cante</span>
        </Link>
      </header>

      <section className="login-shell" aria-labelledby="login-title">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-card-head">
            <div>
              <h1 id="login-title">Sign in</h1>
              <p>
                {authMode === "supabase"
                  ? "Use your approved workspace account."
                  : "Access the PT MA workspace."}
              </p>
            </div>
          </div>

          <label className="login-field">
            <span>{authMode === "supabase" ? "Email" : "Username"}</span>
            <input
              autoComplete="username"
              autoFocus
              name="username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder={authMode === "supabase" ? "name@company.com" : "ptma"}
              type={authMode === "supabase" ? "email" : "text"}
              value={username}
            />
          </label>

          <label className="login-field">
            <span>Password</span>
            <input
              autoComplete="current-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="ptma"
              type="password"
              value={password}
            />
          </label>

          {error ? <p className="login-error">{error}</p> : null}

          <button className="login-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>

          {authMode === "demo" ? (
            <p className="login-demo-note">
              Demo credentials: <strong>ptma</strong> / <strong>ptma</strong>
            </p>
          ) : (
            <p className="login-demo-note">
              No workspace yet? <Link href="/request-access">Request access</Link>
            </p>
          )}
          <Link className="login-home-link" href="/">
            Back to Cante
          </Link>
        </form>
      </section>
    </main>
  );
}
