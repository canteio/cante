"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChipInput } from "@/components/chip-input";
import type { JurisdictionName } from "@/lib/countries";
import { onboardingProfile, WebsiteProfileSchema, type WebsiteProfile } from "@/lib/documents/onboarding";

const EMPTY: WebsiteProfile = { legalName: "", industry: "", products: [], materialsChemicals: [] };
const FALLBACK = "Couldn't read your site — no problem, fill it in yourself.";

export function OnboardingWizard({ country }: { country: JurisdictionName }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<WebsiteProfile>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);

  async function analyze() {
    setBusy(true);
    setNote("");
    try {
      const response = await fetch("/api/onboarding/website", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }), signal: AbortSignal.timeout(40_000),
      });
      const data = await response.json();
      const parsed = WebsiteProfileSchema.safeParse(data.profile);
      if (!response.ok || !parsed.success) throw new Error(FALLBACK);
      // Never overwrite a correction when the customer goes Back to try a website.
      setDraft((current) => ({
        legalName: current.legalName || parsed.data.legalName,
        industry: current.industry || parsed.data.industry,
        products: current.products.length ? current.products : parsed.data.products,
        materialsChemicals: current.materialsChemicals.length ? current.materialsChemicals : parsed.data.materialsChemicals,
      }));
    } catch { setNote(FALLBACK); }
    finally { setBusy(false); setStep(2); }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      // The cloud PUT replaces the whole profile: carry forward unrelated fields
      // so visiting this ungated route cannot erase an existing customer's details.
      const existingResponse = await fetch(`/api/profiles?country=${encodeURIComponent(country)}`, { signal: AbortSignal.timeout(15_000) });
      const existing = await existingResponse.json().catch(() => ({}));
      if (!existingResponse.ok) throw new Error(typeof existing.error === "string" ? existing.error : "Could not load your profile. Please retry.");
      const response = await fetch("/api/profiles", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country, profile: { ...existing.profile, ...onboardingProfile(draft) } }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Profile could not be saved.");
      window.dispatchEvent(new Event("cante:checklist-updated"));
      // Same internal Chat destination pattern as login; never redirect on failure.
      router.push(`/chat?country=${encodeURIComponent(country)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save profile.");
    } finally { setBusy(false); }
  }

  return <main className="onboarding-page">
    <section className="card onboarding-card" aria-labelledby="onboarding-title" aria-busy={busy}>
      <p className="muted" role="status">Step {step} of 3 · {country}</p>
      <div className="page-head"><h1 id="onboarding-title" ref={heading} tabIndex={-1}>
        {step === 1 ? "What's your website?" : step === 2 ? "Tell us about your business" : "You're set"}
      </h1></div>
      {step === 1 && <form className="profile-section-fields" onSubmit={(event) => { event.preventDefault(); if (url.trim()) void analyze(); else setStep(2); }}>
        <p className="page-sub">We’ll read your site to suggest a few details. You can edit everything.</p>
        <label className="login-field" htmlFor="company-website">Company website (optional)
          <input className="input" id="company-website" type="text" inputMode="url" autoComplete="url" placeholder="example.com" maxLength={2048} value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <div className="page-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? "Reading your site…" : "Continue"}</button>
          <button className="btn" type="button" disabled={busy} onClick={() => setStep(2)}>Skip</button>
        </div>
      </form>}
      {step === 2 && <form className="profile-section-fields" onSubmit={(event) => { event.preventDefault(); setStep(3); }}>
        {note && <p className="muted" role="status">{note}</p>}
        <p className="page-sub">Review any suggestions and make them yours. Add more detail in Company Profile later.</p>
        <label className="login-field" htmlFor="business-name">Legal/trading name
          <input className="input" id="business-name" required maxLength={200} value={draft.legalName} onChange={(event) => setDraft({ ...draft, legalName: event.target.value })} />
        </label>
        <label className="login-field" htmlFor="business-industry">Industry
          <input className="input" id="business-industry" maxLength={200} placeholder="e.g. Industrial textile manufacturing" value={draft.industry} onChange={(event) => setDraft({ ...draft, industry: event.target.value })} />
        </label>
        <ChipInput label="Primary products" values={draft.products} placeholder="Industrial tarps" onChange={(products) => setDraft((current) => ({ ...current, products }))} />
        <ChipInput label="Materials" values={draft.materialsChemicals} placeholder="PVC resin" onChange={(materialsChemicals) => setDraft((current) => ({ ...current, materialsChemicals }))} />
        <div className="page-actions"><button className="btn" type="button" onClick={() => setStep(1)}>Back</button><button className="btn btn-primary">Continue</button></div>
      </form>}
      {step === 3 && <div className="profile-section-fields">
        <p className="page-sub">Save these details to start using Cante.</p>
        <div><strong>{draft.legalName}</strong><p>{draft.industry || "Industry not provided"}</p></div>
        <div><span className="side-label">Products</span><div className="onboarding-chips">{draft.products.length ? draft.products.map((product) => <span className="pill pill-muted" key={product}>{product}</span>) : <span className="muted">None added</span>}</div></div>
        <div><span className="side-label">Materials</span><div className="onboarding-chips">{draft.materialsChemicals.length ? draft.materialsChemicals.map((material) => <span className="pill pill-muted" key={material}>{material}</span>) : <span className="muted">None added</span>}</div></div>
        {error && <p className="pill pill-bad" role="alert">{error} Your entries are still here. Please retry.</p>}
        <div className="page-actions"><button className="btn" disabled={busy} onClick={() => { setError(""); setStep(2); }}>Back</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : error ? "Retry save" : "Go to Cante"}</button></div>
      </div>}
    </section>
  </main>;
}
