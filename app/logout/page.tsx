"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function LogoutPage() {
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function logout() {
      await fetch("/api/logout", { method: "POST" }).catch(() => null);
      if (!cancelled) setDone(true);
    }

    void logout();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="simple-auth-page">
      <section className="simple-auth-panel">
        <div className="simple-auth-mark">C</div>
        <h1>{done ? "Signed out." : "Signing out..."}</h1>
        <p>
          {done
            ? "This browser no longer has access to the Cante workspace."
            : "Clearing the current workspace session."}
        </p>
        <Link href="/">{done ? "Return to site" : "Cante"}</Link>
      </section>
    </main>
  );
}
