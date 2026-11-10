import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatMoney } from '../../lib/format';
import { Card, EmptyState, ErrorState, Input, LoadingBlock, PermissionDenied, Select, cx } from '../../components/ui';
import { PageHeader } from '../../components/layout/AppShell';

interface Row {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  isActive: boolean;
  standardRate: string | null;
  lastPurchaseRate: string | null;
  avgPurchaseRate: string | null;
  lastPurchaseDate: string | null;
  lastPurchaseRef: string | null;
  bomLines: number;
  bomLinesFollowing: number;
  projects: string[];
}

const m = (v: string | null) => (v === null ? '—' : formatMoney(v));

/** Every material's rates in one table. Changing a standard rate re-prices the BOM lines that follow it, in every project. */
export function MaterialRatesPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [show, setShow] = useState<'all' | 'bom' | 'noRate' | 'changed'>('all');
  const q = useQuery({ queryKey: ['p', 'material-rates'], queryFn: () => api.get<Row[]>('/material-rates') });
  const rows = q.data ?? [];
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))], [rows]);
  const manage = can('material.manage');
  if (!can('material.view')) return <PermissionDenied />;
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((r) => {
    const text = `${r.code} ${r.name} ${r.category}`.toLowerCase();
    if (!words.every((w) => text.includes(w))) return false;
    if (category && r.category !== category) return false;
    if (show === 'bom') return r.bomLines > 0;
    if (show === 'noRate') return r.standardRate === null;
    if (show === 'changed') return r.lastPurchaseRate !== null && Number(r.lastPurchaseRate) !== Number(r.standardRate);
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Material rates"
        subtitle="One place for every material's rate. Change a standard rate here and BOM lines priced from it are updated in every project at once (rates typed on a BOM line are kept). Approved purchase orders update the last and average purchase rates."
      />
      {q.isLoading ? (
        <LoadingBlock rows={6} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !rows.length ? (
        <Card>
          <EmptyState title="No materials yet" description="Add materials on the Materials tab (or from the preset list) first." />
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted" />
              <Input className="pl-9" placeholder="Search: cement, tmt 12…" aria-label="Search materials" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select className="w-48" aria-label="Category" options={categories.map((c) => ({ value: c, label: c }))} placeholder="All categories" value={category} onChange={(e) => setCategory(e.target.value)} />
            <Select
              className="w-56"
              aria-label="Show"
              options={[
                { value: 'all', label: 'All materials' },
                { value: 'bom', label: 'Used in a BOM' },
                { value: 'noRate', label: 'Without a standard rate' },
                { value: 'changed', label: 'Last PO rate differs' },
              ]}
              value={show}
              onChange={(e) => setShow(e.target.value as typeof show)}
            />
          </div>
          <p className="text-xs text-muted">
            Showing {shown.length} of {rows.length} materials. {manage ? 'Type a new standard rate and press Enter (or leave the box) to save.' : 'Only users who manage materials can change rates.'}
          </p>
          <Card bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-muted uppercase">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Material</th>
                    <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Standard rate</th>
                    <th className="hidden px-3 py-2 text-right font-semibold whitespace-nowrap sm:table-cell">Last PO rate</th>
                    <th className="hidden px-3 py-2 text-right font-semibold whitespace-nowrap md:table-cell">Avg PO rate</th>
                    <th className="hidden px-3 py-2 font-semibold whitespace-nowrap lg:table-cell">Used in BOM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((r) => (
                    <tr key={r.id} className={cx('align-top', !r.isActive && 'opacity-60')}>
                      <td className="min-w-48 px-3 py-2">
                        <span className="block text-ink">{r.name}</span>
                        <span className="block text-xs text-muted">{r.code} · per {r.unit} · {r.category}</span>
                        {/* Phone: the other columns as one line */}
                        <span className="mt-0.5 block text-xs text-muted sm:hidden">
                          Last PO {m(r.lastPurchaseRate)}{r.bomLines ? ` · ${r.bomLines} BOM line${r.bomLines === 1 ? '' : 's'}` : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {manage ? <RateCell key={`${r.id}:${r.standardRate}`} row={r} /> : m(r.standardRate)}
                      </td>
                      <td className="hidden px-3 py-2 text-right whitespace-nowrap sm:table-cell">
                        {m(r.lastPurchaseRate)}
                        {r.lastPurchaseRef && <span className="block text-[11px] text-muted">{r.lastPurchaseRef} · {formatDate(r.lastPurchaseDate)}</span>}
                      </td>
                      <td className="hidden px-3 py-2 text-right whitespace-nowrap md:table-cell">{m(r.avgPurchaseRate)}</td>
                      <td className="hidden px-3 py-2 text-xs lg:table-cell">
                        {r.bomLines ? (
                          <>
                            <span className="block text-ink">{r.bomLines} line{r.bomLines === 1 ? '' : 's'} in {r.projects.join(', ')}</span>
                            <span className="text-muted">{r.bomLinesFollowing} follow{r.bomLinesFollowing === 1 ? 's' : ''} this rate</span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {!shown.length && <p className="text-sm text-muted">Nothing matches the filters.</p>}
        </div>
      )}
    </div>
  );
}

function RateCell({ row }: { row: Row }) {
  const qc = useQueryClient();
  const [v, setV] = useState(row.standardRate === null ? '' : String(Number(row.standardRate)));
  const save = useMutation({
    mutationFn: (rate: string | null) => api.put<{ repriced: { lines: number; projects: number } }>(`/material-rates/${row.id}`, { standardRate: rate }),
    onSuccess: (r) => {
      toast.success(`${row.name}: rate saved${r.repriced.lines ? `. ${r.repriced.lines} BOM line${r.repriced.lines === 1 ? '' : 's'} in ${r.repriced.projects} project${r.repriced.projects === 1 ? '' : 's'} re-priced` : ''}`);
      void qc.invalidateQueries({ queryKey: ['p'] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setV(row.standardRate === null ? '' : String(Number(row.standardRate)));
    },
  });
  const commit = (raw: string) => {
    const t = raw.trim();
    const same = t === '' ? row.standardRate === null : Number(t) === Number(row.standardRate);
    if (!same) save.mutate(t === '' ? null : t);
  };
  const differs = row.lastPurchaseRate !== null && Number(row.lastPurchaseRate) !== Number(row.standardRate);
  return (
    <div className="flex flex-col items-end gap-1">
      <Input
        className="h-8 w-28 text-right"
        inputMode="decimal"
        aria-label={`Standard rate for ${row.name}`}
        placeholder="Rate"
        value={v}
        disabled={save.isPending}
        onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={() => commit(v)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {differs && (
        <button
          type="button"
          className="text-[11px] font-medium text-brand-600 hover:underline"
          onClick={() => {
            const rate = String(Number(row.lastPurchaseRate));
            setV(rate);
            save.mutate(rate);
          }}
        >
          Use last PO {formatMoney(row.lastPurchaseRate!)}
        </button>
      )}
    </div>
  );
}
