import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ListChecks, Search } from 'lucide-react';
import type { MaterialPreset } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Dialog, Input, LoadingBlock, Select, cx } from '../../components/ui';

type Row = MaterialPreset & { exists: boolean };
interface Picked {
  standardRate: string;
}

/** Materials page button: pick common materials from a ready-made list instead of typing each one. */
export function MaterialPresetButton() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (!can('material.manage')) return null;
  return (
    <>
      <Button variant="outline" icon={<ListChecks className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Add from preset list
      </Button>
      {open && <MaterialPresetDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}

export function MaterialPresetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['material-presets'], queryFn: () => api.get<Row[]>('/material-presets') });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [picked, setPicked] = useState<Record<string, Picked>>({});

  const rows = q.data ?? [];
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))], [rows]);
  const visible = useMemo(() => {
    // Every typed word must appear somewhere, so "tmt 12" finds "TMT Bar Fe500D 12 mm".
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      if (category && r.category !== category) return false;
      const text = `${r.name} ${r.code} ${r.category} ${r.specification ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [rows, search, category]);
  const groups = useMemo(() => {
    const g = new Map<string, Row[]>();
    for (const r of visible) g.set(r.category, [...(g.get(r.category) ?? []), r]);
    return [...g.entries()];
  }, [visible]);
  const count = Object.keys(picked).length;

  const toggle = (r: Row, on: boolean) =>
    setPicked((p) => {
      const n = { ...p };
      if (on) n[r.code] = n[r.code] ?? { standardRate: '' };
      else delete n[r.code];
      return n;
    });
  const toggleGroup = (items: Row[], on: boolean) => {
    for (const r of items) if (!r.exists) toggle(r, on);
  };

  const add = useMutation({
    mutationFn: () => api.post<{ created: string[]; skipped: Array<{ code: string; reason: string }> }>('/material-presets', { items: Object.entries(picked).map(([code, v]) => ({ code, standardRate: v.standardRate })) }),
    onSuccess: (r) => {
      toast.success(`${r.created.length} material${r.created.length === 1 ? '' : 's'} added${r.skipped.length ? `, ${r.skipped.length} already in the list` : ''}`);
      void qc.invalidateQueries({ queryKey: ['p'] });
      void qc.invalidateQueries({ queryKey: ['material-presets'] });
      setPicked({});
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="Add materials from the preset list"
      description="Tick the materials you use. Code, category, unit and specification are filled for you; the standard rate is optional and can be added later. Materials not in this list can still be added with “New”."
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted">{count ? `${count} selected` : 'Nothing selected'}</span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!count} loading={add.isPending} onClick={() => add.mutate()}>
            {count ? `Add ${count} material${count === 1 ? '' : 's'}` : 'Add materials'}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Search the preset list" className="pl-9" placeholder="Search: cement, TMT 12, M-Sand…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Category" className="sm:w-60" options={categories.map((c) => ({ value: c, label: c }))} placeholder="All categories" value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>
      {q.isLoading ? (
        <LoadingBlock rows={6} />
      ) : groups.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No preset matches “{search}”. Close this and use “New” to type it in.</p>
      ) : (
        <div className="space-y-4">
          {groups.map(([cat, items]) => {
            const addable = items.filter((r) => !r.exists);
            const allOn = addable.length > 0 && addable.every((r) => picked[r.code]);
            return (
              <section key={cat}>
                <div className="mb-1 flex items-center justify-between border-b border-line pb-1">
                  <h3 className="text-sm font-semibold text-ink">{cat}</h3>
                  {addable.length > 0 && (
                    <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => toggleGroup(items, !allOn)}>
                      {allOn ? 'Clear' : 'Select all'}
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-line">
                  {items.map((r) => {
                    const sel = picked[r.code];
                    return (
                      <li key={r.code} className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 py-2', r.exists && 'opacity-60')}>
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line text-navy-800 focus:ring-brand-500" disabled={r.exists} checked={!!sel} onChange={(e) => toggle(r, e.target.checked)} />
                          <span className="min-w-0">
                            <span className="block text-sm text-ink">{r.name}</span>
                            <span className="block text-xs text-muted">
                              {r.code} · {r.unit}
                              {r.specification ? ` · ${r.specification}` : ''}
                            </span>
                          </span>
                        </label>
                        {r.exists ? (
                          <Badge tone="success">Already added</Badge>
                        ) : (
                          sel && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-muted">Rate ₹ / {r.unit}</span>
                              <Input
                                aria-label={`Standard rate for ${r.name}`}
                                className="num w-28"
                                inputMode="decimal"
                                placeholder="optional"
                                value={sel.standardRate}
                                onChange={(e) => setPicked((p) => ({ ...p, [r.code]: { standardRate: e.target.value.replace(/[^\d.]/g, '') } }))}
                              />
                            </div>
                          )
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
