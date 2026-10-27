import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDate, formatMoney, formatPct, formatQty } from '../../lib/format';
import { Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, PermissionDenied, StatusBadge, cx } from '../../components/ui';
import { ExportMenu } from '../../components/data/DataTable';
import { Page, PageHeader } from '../../components/layout/AppShell';

type ColType = 'text' | 'money' | 'qty' | 'pct' | 'date' | 'int' | 'status';
interface CatalogEntry {
  key: string;
  title: string;
  group: string;
  description: string;
  dateFilter: boolean;
}
interface ReportData {
  key: string;
  title: string;
  group: string;
  columns: Array<{ key: string; label: string; type?: ColType }>;
  rows: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
  notes?: string[];
}

export function cell(v: unknown, type: ColType | undefined, currency?: string) {
  if (v === null || v === undefined || v === '') return <span className="text-slate-400">—</span>;
  switch (type) {
    case 'money':
      return formatMoney(String(v), currency);
    case 'qty':
      return formatQty(String(v), 3);
    case 'pct':
      return formatPct(String(v));
    case 'int':
      return String(v);
    case 'date':
      return formatDate(String(v));
    case 'status':
      return <StatusBadge status={String(v)} />;
    default:
      return String(v);
  }
}

const numeric = (t?: ColType) => t === 'money' || t === 'qty' || t === 'pct' || t === 'int';

export function ReportsPage() {
  const projectId = useProjectId();
  const { can, project } = useAuth();
  const [params, setParams] = useSearchParams();
  const selected = params.get('r');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const catalog = useQuery({ queryKey: ['p', 'reports', projectId], queryFn: () => api.get<{ reports: CatalogEntry[]; canExport: boolean }>(`/projects/${projectId}/reports`) });
  const def = catalog.data?.reports.find((r) => r.key === selected);
  const report = useQuery({
    queryKey: ['p', 'report', projectId, selected, def?.dateFilter ? from : '', def?.dateFilter ? to : ''],
    queryFn: () => api.get<ReportData>(`/projects/${projectId}/reports/${selected}`, def?.dateFilter ? { from, to } : {}),
    enabled: !!selected && !!def,
  });
  const groups = useMemo(() => {
    const m = new Map<string, CatalogEntry[]>();
    for (const r of catalog.data?.reports ?? []) {
      if (search && !`${r.title} ${r.description}`.toLowerCase().includes(search.toLowerCase())) continue;
      m.set(r.group, [...(m.get(r.group) ?? []), r]);
    }
    return [...m.entries()];
  }, [catalog.data, search]);
  if (!can('report.view')) return <Page><PermissionDenied /></Page>;
  const cur = project?.currency;
  const exportTo = (format: 'csv' | 'xlsx' | 'pdf') => {
    window.location.href = api.url(`/projects/${projectId}/reports/${selected}`, { format, ...(def?.dateFilter ? { from, to } : {}) });
  };
  return (
    <Page>
      <PageHeader title="Reports & analytics" subtitle="Every figure is computed on the server from posted transactions at the time you open the report. Exports are audited." />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card bodyClassName="p-0" className={cx(selected && 'hidden lg:block')}>
          <div className="border-b border-line p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-muted" />
              <Input className="pl-8" placeholder="Find a report" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a report" />
            </div>
          </div>
          {catalog.isLoading ? (
            <div className="p-3"><LoadingBlock rows={8} /></div>
          ) : catalog.error ? (
            <ErrorState error={catalog.error} />
          ) : (
            <nav className="max-h-[70vh] overflow-auto py-2" aria-label="Report catalogue">
              {groups.map(([g, items]) => (
                <div key={g} className="mb-2">
                  <p className="px-4 py-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{g}</p>
                  {items.map((r) => (
                    <button key={r.key} type="button" onClick={() => setParams({ r: r.key })} className={cx('block w-full px-4 py-1.5 text-left text-sm hover:bg-surface-50', selected === r.key && 'bg-brand-50 font-medium text-navy-800')}>
                      {r.title}
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          )}
        </Card>
        <div className="min-w-0">
          {!selected || !def ? (
            <EmptyState icon={<BarChart3 className="h-6 w-6" />} title={selected && catalog.data ? 'Report not available' : 'Choose a report'} description={selected && catalog.data ? 'It does not exist or your role cannot view it.' : `${catalog.data?.reports.length ?? 0} reports are available to your role on this project.`} />
          ) : (
            <Card
              title={def.title}
              subtitle={def.description}
              actions={
                <>
                  <Button size="sm" variant="ghost" className="lg:hidden" onClick={() => setParams({})}>All reports</Button>
                  {catalog.data?.canExport && <ExportMenu onExport={exportTo} disabled={!report.data?.rows.length} />}
                </>
              }
              bodyClassName="p-0"
            >
              {def.dateFilter && (
                <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
                  <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                  <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                  {(from || to) && <Button size="sm" variant="ghost" onClick={() => { setFrom(''); setTo(''); }}>Clear</Button>}
                </div>
              )}
              {report.isLoading ? (
                <div className="p-4"><LoadingBlock rows={6} /></div>
              ) : report.error ? (
                <ErrorState error={report.error} onRetry={() => report.refetch()} />
              ) : report.data && !report.data.rows.length ? (
                <EmptyState title="No data for this report" description={report.data.notes?.join(' ') || 'Nothing has been recorded yet for the selected filters.'} />
              ) : report.data ? (
                <>
                  <div className="max-h-[70vh] overflow-auto">
                    <table className="w-full text-sm">
                      <caption className="sr-only">{def.title}</caption>
                      <thead className="sticky top-0 z-10 bg-surface-50 text-left text-xs text-muted">
                        <tr>
                          {report.data.columns.map((c) => (
                            <th key={c.key} scope="col" className={cx('px-3 py-2 font-medium whitespace-nowrap', numeric(c.type) && 'text-right')}>{c.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {report.data.rows.map((r, i) => (
                          <tr key={i} className="border-t border-line hover:bg-surface-50">
                            {report.data!.columns.map((c) => (
                              <td key={c.key} className={cx('px-3 py-1.5', numeric(c.type) && 'text-right tabular-nums whitespace-nowrap')}>{cell(r[c.key], c.type, cur)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      {report.data.totals && (
                        <tfoot className="sticky bottom-0 bg-navy-50 font-semibold">
                          <tr className="border-t-2 border-navy-200">
                            {report.data.columns.map((c) => (
                              <td key={c.key} className={cx('px-3 py-2', numeric(c.type) && 'text-right tabular-nums whitespace-nowrap')}>{report.data!.totals![c.key] !== undefined ? cell(report.data!.totals![c.key], c.type === 'status' ? 'text' : c.type, cur) : ''}</td>
                            ))}
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  <div className="border-t border-line px-4 py-2 text-xs text-muted">
                    {report.data.rows.length} row(s){project?.isDemo ? ' · DEMO DATA, not real project figures' : ''}
                    {report.data.notes?.map((n) => <p key={n} className="mt-1">{n}</p>)}
                  </div>
                </>
              ) : null}
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}

