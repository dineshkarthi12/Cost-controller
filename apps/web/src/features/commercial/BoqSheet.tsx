import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { boqSheetRows, type BoqSheetItem } from '@toprock/shared';
import { api } from '../../lib/api';
import { useProjectId } from '../../lib/auth';
import { formatMoney } from '../../lib/format';
import { Card, EmptyState, ErrorState, Input, LoadingBlock, cx } from '../../components/ui';

const qtyText = (v: string) => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** The BOQ as the Excel shows it: sections, item headings, a/b/c lines, section totals and the grand total. */
export function BoqSheet() {
  const projectId = useProjectId();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['p', 'boq-sheet', projectId], queryFn: () => api.get<{ items: BoqSheetItem[]; total: number }>(`/projects/${projectId}/r/boqItems`, { pageSize: 1000 }), enabled: !!projectId });
  const items = useMemo(() => {
    const all = list.data?.items ?? [];
    const k = q.trim().toLowerCase();
    return k ? all.filter((i) => [i.itemCode, i.description, i.section, i.specification].some((x) => x?.toLowerCase().includes(k))) : all;
  }, [list.data, q]);
  const rows = useMemo(() => boqSheetRows(items), [items]);
  if (list.isLoading) return <LoadingBlock rows={8} />;
  if (list.error) return <ErrorState error={list.error} />;
  if (!list.data?.items.length) return <Card><EmptyState title="No BOQ items yet" description="Import the BOQ Excel with the Import button, or add items one by one." /></Card>;
  return (
    <Card bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <Input className="max-w-sm" value={q} placeholder="Search code, description, section…" aria-label="Search the BOQ" onChange={(e) => setQ(e.target.value)} />
        <span className="text-xs text-muted">{items.length} of {list.data.total} items · in the order of the BOQ file</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 bg-slate-100 text-left text-xs uppercase text-muted">
            <tr>
              <th className="w-20 px-3 py-2">Sl. No</th>
              <th className="px-3 py-2">Description of works</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              r.kind === 'SECTION' ? (
                <tr key={r.key} className="border-t-2 border-navy-200 bg-navy-50">
                  <td className="px-3 py-2 font-bold text-navy-800">{r.no}</td>
                  <td colSpan={5} className="px-3 py-2 font-bold uppercase text-navy-800">{r.title}</td>
                </tr>
              ) : r.kind === 'HEADING' ? (
                <tr key={r.key} className="border-t border-line bg-slate-50/70 align-top">
                  <td className="px-3 py-2 font-semibold">{r.code}</td>
                  <td colSpan={5} className="px-3 py-2"><span className="font-semibold">{r.title}</span>{r.text !== r.title && <span className="text-muted">{r.text.slice(r.title.length).replace(/^\s*:-\s*/, ':- ')}</span>}</td>
                </tr>
              ) : r.kind === 'ITEM' ? (
                <tr key={r.key} className="cursor-pointer border-t border-line/60 align-top hover:bg-brand-50/40" onClick={() => navigate(`/boq/${r.item.id}`)}>
                  <td className="px-3 py-1.5 pl-6 text-muted">{r.code}</td>
                  <td className="px-3 py-1.5">{r.text}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{qtyText(r.qty)}</td>
                  <td className="px-3 py-1.5">{r.item.unit}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(r.rate)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(r.amount)}</td>
                </tr>
              ) : r.kind === 'TOTAL' ? (
                <tr key={r.key} className="border-t border-line bg-amber-50/60">
                  <td />
                  <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase">{r.title}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(r.amount)}</td>
                </tr>
              ) : (
                <tr key={r.key} className={cx('border-t-2 border-navy-300 bg-navy-800 text-white')}>
                  <td />
                  <td colSpan={4} className="px-3 py-2 text-right font-semibold uppercase">Total amount ({r.items} items)</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{formatMoney(r.amount)}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
