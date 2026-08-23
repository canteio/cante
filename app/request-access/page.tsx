"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function RequestAccessPage() {
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = [
      `Company: ${company}`,
      `Email: ${email}`,
      "",
      "What they do:",
      description,
    ].join("\n");

    window.location.href = `mailto:hello@cante.ai?subject=${encodeURIComponent(
      "Cante pilot access request",
    )}&body=${encodeURIComponent(body)}`;
  }

  return (
    <main className="login-page request-page">
      <header className="login-header">
        <Link className="login-wordmark" href="/" aria-label="Cante home">
          Cante
        </Link>
      </header>

      <section className="login-shell request-shell" aria-labelledby="access-title">
        <form className="login-card request-card" onSubmit={handleSubmit}>
          <div className="login-card-head">
            <div>
              <h1 id="access-title">Request access</h1>
              <p>Tell us enough to understand what Cante should monitor.</p>
            </div>
          </div>

          <label className="login-field">
            <span>Company</span>
            <input
              onChange={(event) => setCompany(event.target.value)}
              placeholder="PT MA"
              required
              value={company}
            />
          </label>

          <label className="login-field">
            <span>Work email</span>
            <input
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              required
              type="email"
              value={email}
            />
          </label>

          <label className="login-field">
            <span>Company description or website</span>
            <textarea
              onChange={(event) => setDescription(event.target.value)}
              placeholder="We import PVC inputs from China and manufacture tarpaulins in Surabaya..."
              required
              rows={5}
              value={description}
            />
          </label>

          <button className="login-submit" type="submit">
            Prepare email
          </button>

          <Link className="login-home-link" href="/login">
            Back to sign in
          </Link>
        </form>
      </section>
    </main>
  );
}
