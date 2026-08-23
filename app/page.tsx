import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight } from "lucide-react";

type LandingStyle = CSSProperties & { "--d": string };

const signalSteps = [
  { time: "06:00", label: "Federal Register", value: "Source checked" },
  { time: "06:02", label: "USITC HTS", value: "Change detected" },
  { time: "06:04", label: "EPA TSCA", value: "Relevance matched" },
  { time: "06:05", label: "Daily brief", value: "Ready" },
];

const loginHref = `/login?next=${encodeURIComponent("/chat?country=Indonesia")}`;

export default function LandingPage() {
  return (
    <main className="landing-page">
      <div className="landing-bg" aria-hidden="true">
        <video className="landing-video" autoPlay muted loop playsInline>
          <source src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4" type="video/mp4" />
        </video>
        <div className="landing-shade" />
      </div>

      <header className="landing-header">
        <Link className="landing-wordmark" href="/" aria-label="Cante home">Cante</Link>
        <Link className="landing-signin" href={loginHref}>Sign in</Link>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-pitch">
          <p className="landing-kicker anim" style={{ "--d": "0.1s" } as LandingStyle}>Private regulatory intelligence</p>
          <h1 id="landing-title" className="landing-title">
            <span style={{ "--d": "0.14s" } as LandingStyle}>The rule changed.</span>
            <span style={{ "--d": "0.24s" } as LandingStyle}>You already know.</span>
          </h1>
          <p className="landing-copy anim" style={{ "--d": "0.32s" } as LandingStyle}>Cante checks official sources daily and tells you which changes affect your operations.</p>
          <div className="landing-actions anim" style={{ "--d": "0.43s" } as LandingStyle}>
            <Link className="landing-cta" href="/request-access">Request private access <ArrowRight size={16} strokeWidth={2} /></Link>
            <span className="landing-access-note">Access is reviewed personally.</span>
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
