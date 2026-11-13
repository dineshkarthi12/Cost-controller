import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatMoney, todayIso } from '../../lib/format';
import { Card, Field, Input, KpiCard, Select } from '../../components/ui';
import { DataTable } from '../../components/data/DataTable';
import { PageHeader } from '../../components/layout/AppShell';

interface PayrollRow {
  worker: { id: string; workerCode: string; name: string; trade: string; category: string; contractor: string | null };
  present: number;
  halfDays: number;
  absent: number;
  leave: number;
  paidDays: string;
  regularHours: string;
  overtimeHours: string;
  hourlyRate: string;
  overtimeRate: string;
  regularPay: string;
  overtimePay: string;
  gross: string;
}
interface Payroll {
  from: string;
  to: string;
  scope: 'OWN' | 'ALL';
  rows: PayrollRow[];
  totals: { workers: number; paidDays: string; regularHours: string; overtimeHours: string; regularPay: string; overtimePay: string; gross: string };
}

const monthStart = () => `${todayIso().slice(0, 8)}01`;
const num = (v: string) => String(Number(v));

/** Wages from the attendance register for a period, with an Excel export for payroll. */
export function PayrollPage() {
  const projectId = useProjectId();
  const { can } = useAuth();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());
  const [scope, setScope] = useState<'OWN' | 'ALL'>('OWN');
  const q = useQuery({ queryKey: ['p', 'payroll', projectId, from, to, scope], queryFn: () => api.get<Payroll>(`/projects/${projectId}/manpower/payroll`, { from, to, scope }), enabled: !!from && !!to });
  const t = q.data?.totals;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Payroll"
        subtitle="Wages from the attendance register: paid days = present + ½ half days (leave and absence unpaid), regular hours × rate, overtime at 1.5× the rate."
        actions={
          can('report.export') && (
            <a className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-sm font-medium text-ink hover:bg-slate-50" href={api.url(`/projects/${projectId}/manpower/payroll/export?from=${from}&to=${to}&scope=${scope}`)} download>
              <Download className="h-4 w-4" /> Excel
            </a>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From">
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Workers">
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'OWN' | 'ALL')}
              options={[
                { value: 'OWN', label: 'Own workers' },
                { value: 'ALL', label: 'Own and subcontractor workers' },
              ]}
            />
          </Field>
        </div>
      </Card>
      {t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Workers" value={String(t.workers)} sub={`${num(t.paidDays)} paid days`} />
          <KpiCard label="Regular pay" value={formatMoney(t.regularPay)} sub={`${num(t.regularHours)} hours`} />
          <KpiCard label="Overtime pay" value={formatMoney(t.overtimePay)} sub={`${num(t.overtimeHours)} hours`} />
          <KpiCard label="Gross pay" value={formatMoney(t.gross)} tone="primary" />
        </div>
      )}
      <Card bodyClassName="p-0">
        <DataTable
          rows={q.data?.rows}
          loading={q.isLoading}
          error={q.error}
          rowKey={(r) => r.worker.id}
          empty={{ title: 'No workers for this period', description: 'Add workers in the Workers tab and record attendance in the Attendance register.' }}
          columns={[
            { key: 'id', header: 'Worker', cell: (r) => <span><span className="block font-medium text-navy-800">{r.worker.name}</span><span className="text-xs text-muted">{r.worker.workerCode} · {r.worker.trade}{r.worker.contractor ? ` · ${r.worker.contractor}` : ''}</span></span> },
            { key: 'p', header: 'Present', align: 'right', cell: (r) => r.present },
            { key: 'h', header: 'Half', align: 'right', cell: (r) => r.halfDays, hideOnMobile: true },
            { key: 'l', header: 'Leave', align: 'right', cell: (r) => r.leave, hideOnMobile: true },
            { key: 'a', header: 'Absent', align: 'right', cell: (r) => r.absent, hideOnMobile: true },
            { key: 'pd', header: 'Paid days', align: 'right', cell: (r) => num(r.paidDays) },
            { key: 'hrs', header: 'Hours (OT)', align: 'right', cell: (r) => `${num(r.regularHours)} (${num(r.overtimeHours)})`, hideOnMobile: true },
            { key: 'rate', header: 'Rate / hr', align: 'right', cell: (r) => formatMoney(r.hourlyRate), hideOnMobile: true },
            { key: 'g', header: 'Gross pay', align: 'right', cell: (r) => <strong className="tabular-nums">{formatMoney(r.gross)}</strong> },
          ]}
          mobileCard={(r) => (
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-navy-800">{r.worker.name}</p>
                <p className="text-xs text-muted">{r.worker.trade} · {num(r.paidDays)} paid days · OT {num(r.overtimeHours)} h</p>
              </div>
              <strong className="tabular-nums">{formatMoney(r.gross)}</strong>
            </div>
          )}
        />
      </Card>
    </div>
  );
}
