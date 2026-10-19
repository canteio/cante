"use client";

import { useEffect, useRef, useState } from "react";

export type BeagleMood = "idle" | "waiting" | "talking" | "error";

/** A gently animated companion. Mood reflects transport state, never a claimed check. */
export function CanteBeagle({ mood = "idle", small = false }: { mood?: BeagleMood; small?: boolean }) {
  const [petted, setPetted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <button type="button" className={`cante-beagle${small ? " is-small" : ""}`} data-mood={mood} data-petted={petted || undefined} aria-label="Pet Cante the beagle" onClick={() => {
    setPetted(true); if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPetted(false), 1600);
  }}>
    <svg viewBox="0 0 280 190" fill="none" aria-hidden="true">
      <g className="beagle-body">
        <g className="beagle-head">
          <path d="M81 164V91c0-40 19-66 56-66 35 0 51 22 57 47h63c9 0 12 6 9 16-9 35-39 61-74 63v13c0 3-1 4-4 4H85c-3 0-4-1-4-4Z" fill="#E6B67E" />
          <path className="beagle-ear" d="M119 27 41 63c-13 6-18 9-18 21 0 23 17 39 39 39 31 0 45-41 57-96Z" fill="#74371E" />
          <path className="beagle-eyes" d="M135 89V78c0-17 24-17 24 0v11" stroke="#74371E" strokeWidth="8" strokeLinecap="round" />
          <path className="beagle-mouth" d="M144 112c3 24 17 38 37 42" stroke="#74371E" strokeWidth="8" strokeLinecap="round" />
          <path d="M243 73h16c13 0 16 9 8 20l-12 14c-16-7-24-18-24-32 0-2 4-2 12-2Z" fill="#74371E" />
        </g>
      </g>
    </svg>
  </button>;
}
