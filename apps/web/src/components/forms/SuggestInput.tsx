import { useId, useMemo, useRef, useState } from 'react';
import { cx } from '../ui';

export interface Suggestion {
  value: string;
  /** Small grey line under the value, e.g. "CEM-OPC53 · BAG · Cement". */
  hint?: string;
}

const MAX_SHOWN = 8;

/** Every typed word must appear (in the value or the hint); values that start with the text come first. */
export function matchSuggestions(items: readonly Suggestion[], text: string, max = MAX_SHOWN): Suggestion[] {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const words = t.split(/\s+/);
  const hits = items.filter((s) => {
    const hay = `${s.value} ${s.hint ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const rank = (s: Suggestion) => (s.value.toLowerCase().startsWith(t) ? 0 : s.value.toLowerCase().includes(t) ? 1 : 2);
  return hits.sort((a, b) => rank(a) - rank(b)).slice(0, max);
}

/**
 * Text box that shows matching suggestions under it while you type. Picking one fills the box;
 * anything else can still be typed. Short lists (≤ 30) also open on focus with nothing typed.
 */
export function SuggestInput({
  id,
  value,
  onChange,
  items,
  placeholder,
  maxLength,
  disabled,
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  items: readonly Suggestion[];
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const showAllOnFocus = items.length <= 30;
  const shown = useMemo(() => {
    if (!value.trim()) return showAllOnFocus ? items.slice(0, 30) : [];
    const m = matchSuggestions(items, value, showAllOnFocus ? 30 : MAX_SHOWN);
    // Nothing to suggest once the box already holds exactly one of the items.
    return m.length === 1 && m[0].value.toLowerCase() === value.trim().toLowerCase() ? [] : m;
  }, [items, value, showAllOnFocus]);
  const isOpen = open && shown.length > 0 && !disabled;

  const pick = (s: Suggestion) => {
    onChange(s.value);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        className={cx('input', invalid && 'border-red-400 focus:border-red-500 focus:ring-red-100')}
        aria-invalid={invalid || undefined}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={isOpen ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') return setOpen(false);
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!isOpen) return setOpen(true);
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && isOpen) {
            e.preventDefault();
            pick(shown[Math.min(active, shown.length - 1)]);
          }
        }}
      />
      {isOpen && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg">
          {shown.map((s, i) => (
            <li
              key={s.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cx('cursor-pointer px-3 py-1.5', i === active ? 'bg-brand-50' : 'hover:bg-slate-50')}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
            >
              <span className="block truncate text-sm text-ink">{s.value}</span>
              {s.hint && <span className="block truncate text-xs text-muted">{s.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
