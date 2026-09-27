"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Check } from "lucide-react";

type FormState = "idle" | "submitting" | "success" | "error";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setMessage("");

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          website: form.get("website") || "",
        }),
      });
      const payload = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(payload.message || "We couldn't save your email. Please try again.");
      }

      setState("success");
      setMessage(payload.message || "You're on the list. We'll be in touch.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "We couldn't save your email. Please try again.");
    }
  }

  if (state === "success") {
    return (
      <div className="landing-waitlist-success" role="status" aria-live="polite">
        <span aria-hidden="true"><Check size={18} strokeWidth={2.4} /></span>
        <p>{message}</p>
      </div>
    );
  }

  return (
    <div className="landing-waitlist-wrap">
      <form className="landing-waitlist" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="waitlist-email">Email address</label>
        <input
          aria-describedby={state === "error" ? "waitlist-feedback" : undefined}
          autoComplete="email"
          disabled={state === "submitting"}
          id="waitlist-email"
          inputMode="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          required
          type="email"
          value={email}
        />
        <div className="landing-honeypot" aria-hidden="true">
          <label htmlFor="waitlist-website">Website</label>
          <input id="waitlist-website" name="website" tabIndex={-1} autoComplete="off" />
        </div>
        <button className="landing-cta" disabled={state === "submitting"} type="submit">
          {state === "submitting" ? <span>Joining…</span> : <span>Join the waitlist</span>}
          {state !== "submitting" && <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />}
        </button>
      </form>
      <span className="landing-access-note">Early access. No spam.</span>
      {state === "error" && (
        <p className="landing-waitlist-error" id="waitlist-feedback" role="alert" aria-live="assertive">
          {message}
        </p>
      )}
    </div>
  );
}
