import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useProjectId } from '../../lib/auth';
import { Badge, Card, Select } from '../../components/ui';
import { DataTable } from '../../components/data/DataTable';
import { PageHeader } from '../../components/layout/AppShell';

export interface SupplierRatingRow {
  supplier: { id: string; code: string; name: string };
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | null;
  parts: { delivery: number | null; quality: number | null; invoices: number | null; price: number | null };
  priceIndex: number | null;
  enoughData: boolean;
  counts: { receipts: number; deliveries: number; onTime: number; inspections: number; rejectedInspections: number; invoices: number; invoiceExceptions: number; pricedMaterials: number };
}

const TONE = { A: 'success', B: 'info', C: 'warning', D: 'danger' } as const;

/** Grade chip used here and beside quotations. */
export function SupplierGrade({ rating }: { rating: Pick<SupplierRatingRow, 'grade' | 'score'> | null | undefined }) {
  if (!rating || !rating.grade) return <Badge tone="neutral">No rating yet</Badge>;
  return (
    <Badge tone={TONE[rating.grade]}>
      {rating.grade} · {Math.round(rating.score!)}
    </Badge>
  );
}

const pctCell = (v: number | null, sub?: string) => (v === null ? <span className="text-muted">—</span> : <span className="tabular-nums">{Math.round(v)}%{sub && <span className="block text-[11px] text-muted">{sub}</span>}</span>);

/** Supplier rating from goods receipts, inspections, invoices and PO rates. */
export function SupplierRatingPage() {
  const projectId = useProjectId();
  const [scope, setScope] = useState<'all' | 'project'>('all');
  const q = useQuery({ queryKey: ['supplier-ratings', scope, projectId], queryFn: () => api.get<{ projects: number; rows: SupplierRatingRow[] }>('/supplier-ratings', scope === 'project' ? { projectId } : undefined) });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Supplier rating"
        subtitle="Score out of 100 from what the projects record: on-time delivery 35 %, quality of goods received 35 %, invoices that passed the three-way match 15 %, price against other suppliers of the same material 15 %. Grade A 85+, B 70+, C 55+, D below. A part without data is left out."
        actions={
          <Select
            className="w-52"
            aria-label="Projects"
            value={scope}
            onChange={(e) => setScope(e.target.value as 'all' | 'project')}
            options={[
              { value: 'all', label: 'All my projects' },
              { value: 'project', label: 'Current project only' },
            ]}
          />
        }
      />
      <Card bodyClassName="p-0">
        <DataTable
          rows={q.data?.rows}
          loading={q.isLoading}
          error={q.error}
          rowKey={(r) => r.supplier.id}
          empty={{ title: 'No supplier history yet', description: 'Ratings appear once goods receipts or supplier invoices are approved.' }}
          columns={[
            { key: 's', header: 'Supplier', cell: (r) => <span><span className="block font-medium text-navy-800">{r.supplier.name}</span><span className="text-xs text-muted">{r.supplier.code}</span></span> },
            { key: 'g', header: 'Rating', cell: (r) => <SupplierGrade rating={r} /> },
            { key: 'd', header: 'On time', align: 'right', cell: (r) => pctCell(r.parts.delivery, r.counts.deliveries ? `${r.counts.onTime} of ${r.counts.deliveries}` : undefined) },
            { key: 'q', header: 'Quality', align: 'right', cell: (r) => pctCell(r.parts.quality, r.counts.inspections ? `${r.counts.rejectedInspections} of ${r.counts.inspections} MIR rejected` : r.counts.receipts ? 'accepted qty' : undefined), hideOnMobile: true },
            { key: 'i', header: 'Invoices OK', align: 'right', cell: (r) => pctCell(r.parts.invoices, r.counts.invoices ? `${r.counts.invoiceExceptions} exception${r.counts.invoiceExceptions === 1 ? '' : 's'} of ${r.counts.invoices}` : undefined), hideOnMobile: true },
            {
              key: 'p',
              header: 'Price vs others',
              align: 'right',
              cell: (r) =>
                r.priceIndex === null ? (
                  <span className="text-muted">—</span>
                ) : (
                  <span className={r.priceIndex > 1.005 ? 'text-red-600' : 'text-emerald-700'}>
                    {r.priceIndex > 1 ? '+' : ''}
                    {((r.priceIndex - 1) * 100).toFixed(1)}%<span className="block text-[11px] text-muted">{r.counts.pricedMaterials} material{r.counts.pricedMaterials === 1 ? '' : 's'}</span>
                  </span>
                ),
              hideOnMobile: true,
            },
          ]}
          mobileCard={(r) => (
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-navy-800">{r.supplier.name}</p>
                <p className="text-xs text-muted">On time {r.parts.delivery === null ? '—' : `${Math.round(r.parts.delivery)}%`} · quality {r.parts.quality === null ? '—' : `${Math.round(r.parts.quality)}%`}</p>
              </div>
              <SupplierGrade rating={r} />
            </div>
          )}
        />
      </Card>
    </div>
  );
}
