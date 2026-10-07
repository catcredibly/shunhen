import { useEffect, useRef, useState } from "react";
import { Row } from "./SettingsControls";

/** Drag locally, coalesce pending writes, and ignore stale SQLite echoes while saving. */
export function OpacitySetting({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (value: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const pending = useRef<number | undefined>(undefined),
    writing = useRef(false),
    stored = useRef(value),
    save = useRef(onChange);
  stored.current = value;
  save.current = onChange;
  useEffect(() => {
    if (pending.current === undefined) setDraft(value);
    else if (!writing.current && value === pending.current) pending.current = undefined;
  }, [value]);
  const flush = async () => {
    if (writing.current) return;
    writing.current = true;
    try {
      while (pending.current !== undefined) {
        const requested = pending.current;
        await save.current(requested);
        if (pending.current === requested) break;
      }
      if (stored.current === pending.current) pending.current = undefined;
    } catch (error) {
      pending.current = undefined;
      setDraft(stored.current);
      console.error(error);
    } finally {
      writing.current = false;
    }
  };
  return (
    <Row label={label} hint={draft + "%"}>
      <input
        aria-label={label}
        type="range"
        min="0"
        max="100"
        step={step}
        value={draft}
        onChange={(event) => {
          const next = Number(event.target.value);
          pending.current = next;
          setDraft(next);
          void flush();
        }}
      />
    </Row>
  );
}
