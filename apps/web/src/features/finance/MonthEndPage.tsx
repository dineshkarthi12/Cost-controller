import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, CircleDashed, Lock, MinusCircle, Unlock } from 'lucide-react';
import type { CostPosition } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDate, formatDateTime, formatMoney, humanize } from '../../lib/format';
import { Badge, Button, Card, ConfirmDialog, DescriptionList, ErrorState, Input, LoadingBlock, PermissionDenied, StatusBadge, Textarea, cx } from '../../components/ui';
import { DataTable } from '../../components/data/DataTable';
import { ApprovalTimeline } from '../../components/record/Panels';
import { Page, PageHeader } from '../../components/layout/AppShell';

interface Item {
  id: string;
  key: string;
  label: string;
  status: string;
  autoCount: number | null;
  note: string | null;
  completedAt: string | null;
}
interface Period {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  status: string;
  closedAt: string | null;
  reopenedReason: string | null;
  varianceNotes: string | null;
  checklist: Item[];
  periodMovements?: Record<string, string>;
  positionAtPeriodEnd?: CostPosition;
  canReopen?: boolean;
}

export function MonthEndPage() {
  const projectId = useProjectId();
  const { can } = useAuth();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['p', 'periods', projectId], queryFn: () => api.get<Period[]>(`/projects/${projectId}/periods`) });
  if (!can('period.view')) return <Page><PermissionDenied /></Page>;
  return (
    <Page>
      <PageHeader title="Month-end closing" subtitle="Each period has a checklist. Closing needs every item done or waived with a note, then reviewer sign-off. Closed periods reject postings until an authorised user reopens them with a reason." />
      <Card bodyClassName="p-0">
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/month-end/${r.id}`)}
          columns={[
            { key: 'code', header: 'Period', cell: (r) => <span className="font-medium text-navy-800">{r.code}</span> },
            { key: 'range', header: 'Dates', cell: (r) => `${formatDate(r.startDate)} – ${formatDate(r.endDate)}` },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'progress', header: 'Checklist', cell: (r) => `${r.checklist.filter((c) => c.status !== 'PENDING').length} / ${r.checklist.length}` },
            { key: 'closed', header: 'Closed', cell: (r) => formatDate(r.closedAt) },
          ]}
        />
      </Card>
    </Page>
  );
}

export function PeriodDetailPage() {
  const { id = '' } = useParams();
  const projectId = useProjectId();
  const { can, project } = useAuth();
  const qc = useQueryClient();
  const [reopen, setReopen] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [waive, setWaive] = useState<{ key: string; note: string } | null>(null);
  const q = useQuery({ queryKey: ['p', 'period', id], queryFn: () => api.get<Period>(`/projects/${projectId}/periods/${id}`) });
  const inv = () => void qc.invalidateQueries({ queryKey: ['p'] });
  const setItem = useMutation({ mutationFn: ({ key, status, note }: { key: string; status: string; note?: string }) => api.post(`/projects/${projectId}/periods/${id}/checklist/${key}`, { status, note }), onSuccess: () => { setWaive(null); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const saveNotes = useMutation({ mutationFn: () => api.patch(`/projects/${projectId}/periods/${id}`, { varianceNotes: notes }), onSuccess: () => { toast.success('Variance analysis saved'); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const close = useMutation({ mutationFn: () => api.post(`/projects/${projectId}/periods/${id}/close`), onSuccess: () => { toast.success('Submitted for sign-off'); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const reopenM = useMutation({ mutationFn: (reason: string) => api.post(`/projects/${projectId}/periods/${id}/reopen`, { reason }), onSuccess: () => { toast.success('Period reopened'); setReopen(false); inv(); }, onError: (e: Error) => toast.error(e.message) });
  if (q.isLoading) return <Page><LoadingBlock rows={6} /></Page>;
  if (q.error || !q.data) return <Page><ErrorState error={q.error} /></Page>;
  const p = q.data;
  const open = p.status === 'OPEN';
  const editable = open && can('period.manage');
  const pending = p.checklist.filter((c) => c.status === 'PENDING').length;
  const cur = project?.currency;
  return (
    <Page className="max-w-5xl">
      <PageHeader
        breadcrumbs={[{ label: 'Month-end closing', to: '/month-end' }, { label: p.code }]}
        title={<span className="flex items-center gap-3">Period {p.code} <StatusBadge status={p.status} /></span>}
        subtitle={`${formatDate(p.startDate)} – ${formatDate(p.endDate)}`}
        actions={
          <>
            {editable && <Button icon={<Lock className="h-4 w-4" />} disabled={pending > 0} loading={close.isPending} onClick={() => close.mutate()} title={pending ? `${pending} checklist item(s) pending` : undefined}>Submit for close</Button>}
            {p.status === 'CLOSED' && p.canReopen && <Button variant="outline" icon={<Unlock className="h-4 w-4" />} onClick={() => setReopen(true)}>Reopen</Button>}
          </>
        }
      />
      {p.reopenedReason && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Previously reopened: {p.reopenedReason}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Checklist" className="lg:col-span-2" subtitle="Counts are computed from live data. Each item still needs a person to confirm or waive it.">
          <ul className="divide-y divide-line">
            {p.checklist.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-start gap-2">
                  {c.status === 'DONE' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : c.status === 'WAIVED' ? <MinusCircle className="mt-0.5 h-4 w-4 text-amber-600" /> : <CircleDashed className="mt-0.5 h-4 w-4 text-slate-400" />}
                  <div>
                    <p className="text-sm">{c.label}</p>
                    <p className="text-xs text-muted">
                      {c.autoCount !== null && <span className={cx(c.autoCount > 0 && 'font-medium text-amber-700')}>{c.autoCount} open item(s) · </span>}
                      {c.note}
                      {c.completedAt && ` · ${formatDateTime(c.completedAt)}`}
                    </p>
                  </div>
                </div>
                {editable && (
                  <div className="flex gap-1">
                    {c.status !== 'DONE' && <Button size="sm" variant="success" onClick={() => setItem.mutate({ key: c.key, status: 'DONE' })}>Done</Button>}
                    {c.status !== 'WAIVED' && <Button size="sm" variant="outline" onClick={() => setWaive({ key: c.key, note: '' })}>Waive</Button>}
                    {c.status !== 'PENDING' && <Button size="sm" variant="ghost" onClick={() => setItem.mutate({ key: c.key, status: 'PENDING' })}>Undo</Button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4">
          <Card title="Movements in period">
            <DescriptionList columns={2} items={['ACTUAL', 'ACCRUAL', 'COMMITMENT'].map((k) => ({ label: humanize(k), value: formatMoney(p.periodMovements?.[k] ?? '0', cur) }))} />
          </Card>
          <Card title="Position at period end">
            {p.positionAtPeriodEnd && <DescriptionList columns={2} items={[{ label: 'Approved budget', value: formatMoney(p.positionAtPeriodEnd.approvedBudget, cur) }, { label: 'Cost incurred', value: formatMoney(p.positionAtPeriodEnd.incurred, cur) }, { label: 'Open commitments', value: formatMoney(p.positionAtPeriodEnd.openCommitments, cur) }, { label: 'EAC (current forecast)', value: formatMoney(p.positionAtPeriodEnd.eac, cur) }]} />}
          </Card>
        </div>
        <Card title="Period variance analysis" className="lg:col-span-2">
          <Textarea rows={5} value={notes ?? p.varianceNotes ?? ''} onChange={(e) => setNotes(e.target.value)} disabled={!editable} aria-label="Variance analysis" placeholder="Explain significant cost movements and forecast changes this period…" />
          {editable && (
            <div className="mt-2 flex justify-end">
              <Button size="sm" loading={saveNotes.isPending} disabled={notes === null} onClick={() => saveNotes.mutate()}>Save analysis</Button>
            </div>
          )}
        </Card>
        <Card title="Sign-off">
          <ApprovalTimeline docType="PERIOD_CLOSE" entityId={p.id} onChanged={() => q.refetch()} />
        </Card>
      </div>
      <ConfirmDialog open={!!waive} onOpenChange={(o) => !o && setWaive(null)} title="Waive checklist item" message="Explain why this item does not apply this period." requireReason reasonLabel="Note" confirmLabel="Waive" onConfirm={(note) => waive && setItem.mutate({ key: waive.key, status: 'WAIVED', note })} />
      <ConfirmDialog open={reopen} onOpenChange={setReopen} title={`Reopen period ${p.code}?`} message="Postings dated in this period will be accepted again. The reason is recorded in the audit trail." requireReason reasonLabel="Reason (min. 10 characters)" tone="danger" confirmLabel="Reopen" loading={reopenM.isPending} onConfirm={(r) => reopenM.mutate(r)} />
      <Input type="hidden" />
      {p.status === 'CLOSING' && <Badge tone="info" className="mt-3">Awaiting reviewer sign-off</Badge>}
    </Page>
  );
}
