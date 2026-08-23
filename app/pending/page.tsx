import Link from "next/link";
import { Clock3 } from "lucide-react";

export default function PendingPage() {
  return (
    <main className="simple-auth-page">
      <section className="simple-auth-panel">
        <div className="simple-auth-mark">
          <Clock3 size={24} strokeWidth={1.8} />
        </div>
        <h1>Access pending.</h1>
        <p>
          Your email is signed in, but it has not been attached to an approved
          Cante customer workspace yet.
        </p>
        <div className="simple-auth-actions">
          <Link href="/request-access">Request access</Link>
          <Link href="/logout">Sign out</Link>
        </div>
      </section>
    </main>
  );
}
