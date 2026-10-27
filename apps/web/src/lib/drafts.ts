import { useEffect, useRef, useState } from 'react';
import type { UseFormReturn, FieldValues } from 'react-hook-form';

/**
 * Preserves unsaved form input in localStorage (UI convenience only — never authoritative).
 * Returns whether a draft was restored and a function to discard it.
 */
export function useFormDraft<T extends FieldValues>(key: string | null, form: UseFormReturn<T>, enabled = true) {
  const [restored, setRestored] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    if (!key || !enabled || loaded.current) return;
    loaded.current = true;
    try {
      const raw = localStorage.getItem(`tr.draft.${key}`);
      if (raw) {
        form.reset({ ...form.getValues(), ...JSON.parse(raw) });
        setRestored(true);
      }
    } catch {
      /* ignore */
    }
  }, [key, enabled, form]);
  useEffect(() => {
    if (!key || !enabled) return;
    let t: ReturnType<typeof setTimeout>;
    const sub = form.watch((values) => {
      clearTimeout(t);
      t = setTimeout(() => {
        try {
          localStorage.setItem(`tr.draft.${key}`, JSON.stringify(values));
        } catch {
          /* quota / private mode */
        }
      }, 400);
    });
    return () => {
      clearTimeout(t);
      sub.unsubscribe();
    };
  }, [key, enabled, form]);
  const discard = () => {
    if (!key) return;
    try {
      localStorage.removeItem(`tr.draft.${key}`);
    } catch {
      /* ignore */
    }
    setRestored(false);
  };
  return { restored, discard };
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(`tr.draft.${key}`);
  } catch {
    /* ignore */
  }
}
