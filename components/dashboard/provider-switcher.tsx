"use client";

import { Bot, Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openingEdge = useRef<"first" | "last">("first");
  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    const item = openingEdge.current === "last" ? items?.[items.length - 1] : items?.[0];
    // Focus the menu itself while providers load so Escape and Tab still work.
    (item ?? menuRef.current)?.focus();
    function onPointerDown(e: PointerEvent) {
      if (e.target instanceof Node && !menuRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) {
        // Outside clicks keep their own focus target, including on touch screens.
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
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
    close(); // return focus to trigger, not just hide the menu
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
        ref={triggerRef}
        type="button"
        className="provider-current"
        id={`${menuId}-trigger`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-label={`AI provider: ${active?.shortLabel ?? selected}`}
        onClick={() => {
          openingEdge.current = "first";
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openingEdge.current = event.key === "ArrowUp" ? "last" : "first";
            setOpen(true);
          }
        }}
      >
        <Bot size={13} />
        <span>{active?.shortLabel ?? selected}</span>
        <span className={`provider-dot${active?.ok ? " is-ok" : " is-bad"}`} />
        <ChevronDown size={12} />
      </button>

      {open && (
        <div
          className="provider-menu"
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={`${menuId}-trigger`}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === "Tab") {
              // Let the browser move forward/backward from the trigger, not a removed item.
              close();
            } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
              if (items.length === 0) return;
              const current = items.findIndex((item) => item === document.activeElement);
              const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
                : event.key === "ArrowDown" ? (current + 1) % items.length
                : current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
              items[next]?.focus();
            }
          }}
        >
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="provider-option"
              role="menuitemradio"
              aria-checked={provider.id === selected}
              // Unavailable options stay discoverable by keyboard, but cannot be chosen.
              aria-disabled={!provider.ok || saving}
              tabIndex={-1}
              style={!provider.ok || saving ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
              data-active={provider.id === selected}
              onClick={() => {
                if (provider.ok && !saving) void choose(provider.id);
              }}
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
