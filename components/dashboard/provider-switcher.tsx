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

  async function load() {
    const data = await fetch("/api/llm").then((res) => res.json());
    setSelected(data.selected ?? initialProvider);
    setProviders(data.providers ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function choose(provider: LlmProviderChoice) {
    setSaving(true);
    setSelected(provider);
    setOpen(false);
    const res = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    await load();
    if (res.ok) window.dispatchEvent(new Event("cante:provider-changed"));
    setSaving(false);
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
        {saving ? "Switching provider…" : active?.detail ?? "Checking provider…"}
      </div>
    </div>
  );
}
