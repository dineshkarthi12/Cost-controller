import { useEffect, useId, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import type { RefSource } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { cx } from '../ui';

export interface RefOption {
  value: string;
  label: string;
  extra?: Record<string, string | null>;
}

const PROJECT_SOURCES: RefSource[] = ['costCodes', 'wbsNodes', 'boqItems', 'activities', 'stores', 'subcontracts', 'purchaseOrders', 'poLines', 'grns', 'mrs', 'prs', 'contracts', 'documents', 'clientBills', 'ncrs', 'inspections', 'milestones', 'measurements'];

function lookupPath(source: RefSource, projectId: string | null) {
  return projectId ? `/projects/${projectId}/lookups/${source}` : PROJECT_SOURCES.includes(source) ? null : `/lookups/${source}`;
}

/** Accessible async combobox for reference fields (cost codes, suppliers, materials…). */
export function RefSelect({ source, value, onChange, label, initialLabel, placeholder = 'Select…', disabled, invalid, params, id }: { source: RefSource; value: string | null | undefined; onChange: (value: string | null, option?: RefOption) => void; label?: string; initialLabel?: string | null; placeholder?: string; disabled?: boolean; invalid?: boolean; params?: Record<string, string | undefined>; id?: string }) {
  const { projectId } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const path = lookupPath(source, projectId);
  const options = useQuery({
    queryKey: ['p', 'lookup', projectId, source, debounced, params],
    queryFn: () => api.get<RefOption[]>(path!, { q: debounced, ...params }),
    enabled: open && !!path,
    staleTime: 60_000,
  });
  const selectedLabel = useQuery({
    queryKey: ['p', 'lookup-label', projectId, source, value],
    queryFn: () => api.get<RefOption[]>(path!, { ids: value! }),
    enabled: !!value && !initialLabel && !!path,
    staleTime: 300_000,
  });
  const display = useMemo(() => {
    if (!value) return '';
    return initialLabel ?? selectedLabel.data?.[0]?.label ?? options.data?.find((o) => o.value === value)?.label ?? '…';
  }, [value, initialLabel, selectedLabel.data, options.data]);
  const items = options.data ?? [];

  const choose = (o: RefOption | null) => {
    onChange(o?.value ?? null, o ?? undefined);
    setOpen(false);
    setQ('');
  };

  return (
    <Popover.Root open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cx('input flex items-center justify-between gap-2 text-left', !value && 'text-slate-400', invalid && 'border-red-400')}
        >
          <span className="truncate">{value ? display : placeholder}</span>
          <span className="flex items-center gap-1">
            {value && !disabled && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-ink"
                onClick={(e) => {
                  e.stopPropagation();
                  choose(null);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronDown className="h-4 w-4 text-muted" />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-[60] w-[var(--radix-popover-trigger-width)] min-w-[260px] rounded-lg border border-line bg-white p-1 shadow-lg">
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && items[active]) {
                e.preventDefault();
                choose(items[active]);
              }
            }}
            placeholder="Type to search…"
            className="mb-1 w-full rounded-md border border-line px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            role="combobox"
            aria-controls={listId}
            aria-expanded="true"
            aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          />
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto">
            {options.isLoading && (
              <li className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </li>
            )}
            {!options.isLoading && items.length === 0 && <li className="px-2.5 py-2 text-sm text-muted">No matches</li>}
            {items.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                className={cx('flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm', i === active ? 'bg-slate-100' : '', o.value === value && 'font-medium text-navy-800')}
              >
                <span className="truncate">{o.label}</span>
                {o.value === value && <Check className="h-4 w-4 shrink-0" />}
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
