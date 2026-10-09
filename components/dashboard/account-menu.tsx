"use client";

import { Brain, ChevronDown, LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Account menu: avatar + email, opens to Memory & Facts / Sign out.
 * Replaces the old "Active Workspace" customer list and the AI-provider
 * switcher in the sidebar footer — end users don't need to see or choose
 * which backend AI runtime serves the app. That selection is now fixed by
 * server config (CANTE_LLM / CANTE_LLM_LOCKED) instead of exposed in the UI.
 */
export function AccountMenu({
  email,
  memoryHref,
}: {
  email: string | null;
  memoryHref: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]');
    (items?.[0] ?? menuRef.current)?.focus();
    function onPointerDown(e: PointerEvent) {
      if (
        e.target instanceof Node &&
        !menuRef.current?.contains(e.target) &&
        !triggerRef.current?.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const label = email ?? "Demo account";
  const initial = (email?.trim()[0] ?? "D").toUpperCase();

  return (
    <div className="account-menu">
      <button
        ref={triggerRef}
        type="button"
        className="account-trigger"
        id={`${menuId}-trigger`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-avatar">{initial}</span>
        <span className="account-label">{label}</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div
          className="account-dropdown"
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={`${menuId}-trigger`}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        >
          {/* MVP: memory UI retained but disabled.
          <Link href={memoryHref} role="menuitem" className="account-item" onClick={close}>
            <Brain size={14} strokeWidth={1.75} />
            Memory & Facts
          </Link>
          <div className="account-divider" />
          */}
          <Link href="/logout" role="menuitem" className="account-item account-item-danger" onClick={close}>
            <LogOut size={14} strokeWidth={1.75} />
            Sign out
          </Link>
        </div>
      )}
    </div>
  );
}
