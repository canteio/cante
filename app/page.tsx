import Link from "next/link";
import type { CSSProperties } from "react";
import type { Viewport } from "next";
import { BrandMark } from "@/components/brand-mark";
import { WaitlistForm } from "@/components/waitlist-form";
import { getAuthMode, hasSupabaseEnv, DEMO_SESSION_COOKIE, DEMO_SESSION_VALUE } from "@/lib/auth/config";

type LandingStyle = CSSProperties & { "--d": string };

// This page is light; without an explicit theme-color, mobile browsers
// (Safari, Chrome, in-app browsers like Telegram's) default the address-bar
// and system-UI tint to black, which reads as a black bar around the page.
export const viewport: Viewport = {
  themeColor: "#fafafa",
};

const signalSteps = [
  { time: "06:00", label: "Federal Register", value: "Source checked" },
  { time: "06:02", label: "USITC HTS", value: "Change detected" },
  { time: "06:04", label: "EPA TSCA", value: "Relevance matched" },
  { time: "06:05", label: "Daily brief", value: "Ready" },
];

/**
 * True when the visitor already has a live session — demo cookie, or a
 * verified Supabase session — so the header button can skip straight to
 * the dashboard instead of making an already-signed-in visitor log in again.
 */
async function isAlreadySignedIn(): Promise<boolean> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();

  if (getAuthMode() !== "supabase") {
    return jar.get(DEMO_SESSION_COOKIE)?.value === DEMO_SESSION_VALUE;
  }
  if (!hasSupabaseEnv()) return false;
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    return Boolean(data?.claims && !error);
  } catch {
    // The landing page renders a plain "Sign in" link rather than failing.
    return false;
  }
}

export default async function LandingPage() {
  const signedIn = await isAlreadySignedIn();

  return (
    <main className="landing-page">
      <div className="landing-bg" aria-hidden="true">
        <video className="landing-video" autoPlay muted loop playsInline>
          <source src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4" type="video/mp4" />
        </video>
        <div className="landing-shade" />
      </div>

      <Link className="landing-login-btn" href={signedIn ? "/chat" : "/login"}>
        {signedIn ? "Go to dashboard" : "Sign in"}
      </Link>

      <header className="landing-header">
        <Link className="landing-wordmark" href="/" aria-label="Cante home">
          <BrandMark />
          <span>Cante</span>
        </Link>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-pitch">
          <h1 id="landing-title" className="landing-title">
            <span style={{ "--d": "0.14s" } as LandingStyle}>Simplify Import/Export{" "}</span>
            <span style={{ "--d": "0.24s" } as LandingStyle}>Compliance.</span>
          </h1>
          <p className="landing-copy anim" style={{ "--d": "0.32s" } as LandingStyle}>
            Cante checks official sources daily and tells you which changes affect your operations.
          </p>
          <div className="landing-actions anim" id="waitlist" style={{ "--d": "0.43s" } as LandingStyle}>
            <WaitlistForm />
          </div>
        </div>
      </section>

      <aside className="landing-stream" aria-label="Illustrative daily scan activity">
        <span className="landing-stream-label">Illustrative daily scan</span>
        <div className="landing-stream-window">
          <div className="landing-stream-track">
            {[...signalSteps, ...signalSteps].map((step, index) => (
              <div className="landing-stream-item" key={`${step.time}-${index}`} aria-hidden={index >= signalSteps.length}>
                <time>{step.time}</time><span>{step.label}</span><strong>{step.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}
