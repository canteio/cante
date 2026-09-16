"use client";

import { Bot, Check, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { LlmProviderChoice } from "@/lib/llm";

type ProviderStatus = {
  id: LlmProviderChoice;
  label: string;
  shortLabel: string;
  description: string;
  selected: boolean;
  ok: boolean;
  detail: string;
};

export function ProviderSwitcher({
  initialProvider,
}: {
  initialProvider: LlmProviderChoice;
}) {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [selected, setSelected] = useState<LlmProviderChoice>(initialProvider);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Silent-failure fix (matches the audit already applied to every other
  // panel in the app): a failed /api/llm fetch — network error, or a non-2xx
  // response whose body isn't JSON — used to throw inside an un-awaited,
  // un-caught promise. The catch never ran, providers stayed `[]` forever,
  // and the UI was stuck showing "Checking provider…" with zero indication
  // anything went wrong or how to recover. Track the failure explicitly and
  // offer a retry instead of a silent dead end.
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const res = await fetch("/api/llm");
      if (!res.ok) throw new Error(`Failed to load providers (${res.status})`);
      const data = await res.json();
      setSelected(data.selected ?? initialProvider);
      setProviders(data.providers ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function choose(provider: LlmProviderChoice) {
    setSaving(true);
    setSelected(provider);
    setOpen(false);
    try {
      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      await load();
      if (res.ok) window.dispatchEvent(new Event("cante:provider-changed"));
      else setLoadError(`Failed to switch provider (${res.status})`);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const active = providers.find((provider) => provider.id === selected);

  return (
    <div className="provider-switcher">
      <button
        type="button"
        className="provider-current"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bot size={13} />
        <span>{active?.shortLabel ?? selected}</span>
        <span className={`provider-dot${active?.ok ? " is-ok" : " is-bad"}`} />
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="provider-menu">
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="provider-option"
              data-active={provider.id === selected}
              disabled={!provider.ok}
              onClick={() => choose(provider.id)}
            >
              <span className={`provider-dot${provider.ok ? " is-ok" : " is-bad"}`} />
              <span className="provider-copy">
                <strong>{provider.label}</strong>
                <small>{provider.description}</small>
                <small>{provider.detail}</small>
              </span>
              {provider.id === selected && <Check size={13} />}
            </button>
          ))}
        </div>
      )}

      <div className="provider-detail">
        {saving ? "Switching provider…" : loadError ? (
          <span className="callout callout-bad" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {loadError}
            <button type="button" className="btn btn-small" onClick={() => void load()}>Retry</button>
          </span>
        ) : active?.detail ?? "Checking provider…"}
      </div>
    </div>
  );
}
