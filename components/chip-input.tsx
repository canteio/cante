"use client";

import { useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

/** One list-entry pattern: values live inside the control, never in a separate table.
 * Blur commits pending text too, so clicking Save cannot silently omit the last item.
 * Escape bubbles to the owning disclosure; removing a chip restores input focus.
 */
export function ChipInput({ label, values, onChange, placeholder, disabled = false }: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  function add() {
    const value = draft.trim();
    if (!value) return;
    if (!values.includes(value)) onChange([...values, value]);
    setAnnouncement(values.includes(value) ? `${value} is already added` : `Added ${value}`);
    setDraft("");
  }
  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index));
    setAnnouncement(`Removed ${values[index]}`);
    input.current?.focus();
  }
  return (
    <div className="chip-field">
      <label htmlFor={id} className="side-label">{label}</label>
      <div className="chip-input">
        {values.map((value, index) => (
          <span className="pill pill-muted chip-input-value" key={`${index}-${value}`}>
            {value}
            <button type="button" disabled={disabled} aria-label={`Remove ${value} from ${label}`} onClick={() => remove(index)}><X size={14} aria-hidden="true" /></button>
          </span>
        ))}
        <input ref={input} id={id} value={draft} disabled={disabled} aria-describedby={`${id}-hint`}
          placeholder={values.length ? "Add another…" : `e.g. ${placeholder.replace(/^e\.g\.\s*/, "")}`}
          onChange={(event) => setDraft(event.target.value)} onBlur={add}
          onKeyDown={(event) => {
            // IME Enter confirms composition, not a new list item.
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") { event.preventDefault(); add(); }
            if (event.key === "Backspace" && !draft && values.length) {
              event.preventDefault(); remove(values.length - 1);
            }
          }} />
        <button type="button" disabled={disabled || !draft.trim()} aria-label={`Add to ${label}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { add(); input.current?.focus(); }}><Plus size={16} aria-hidden="true" /></button>
      </div>
      <small id={`${id}-hint`} className="muted">Type one item, then press Enter. {values.length === 0 && "Example only — nothing added yet."}</small>
      <span className="sr-only" role="status">{announcement}</span>
    </div>
  );
}
