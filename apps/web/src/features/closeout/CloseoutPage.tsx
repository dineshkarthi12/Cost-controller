import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, CheckCircle2, CircleDashed, Flag, MinusCircle, Send } from 'lucide-react';
import type { CostPosition } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDateTime, formatMoney, humanize } from '../../lib/format';
import { Button, Card, ConfirmDialog, DescriptionList, EmptyState, ErrorState, KpiCard, LoadingBlock, PermissionDenied, ProgressBar, StatusBadge, Textarea, cx } from '../../components/ui';
import { ApprovalTimeline } from '../../components/record/Panels';
import { Page, PageHeader } from '../../components/layout/AppShell';

interface Item {
  id: string;
  key: string;
  label: string;
  status: string;
  note: string | null;
  completedAt: string | null;
}
interface CloseoutResp {
  closeout: { id: string; status: string; lessonsLearned: string | null; archivedAt: string | null; items: Item[] } | null;
  finalCost: CostPosition;
  byCategory: Array<{ category: string; position: CostPosition }>;
  indicators: Record<string, number>;
}

const INDICATORS: Array<[string, string, string]> = [
  ['uncertifiedMeasurements', 'Uncertified measurements', '/measurements'],
  ['openPos', 'Open purchase orders', '/procurement/po'],
  ['unpaidInvoices', 'Unpaid supplier invoices', '/payables/invoices'],
  ['openClaims', 'Open claims', '/risks/claims'],
  ['openNcrs', 'Open NCRs', '/quality/ncrs'],
  ['stockLines', 'Store/material lines with stock', '/stock'],
  ['openPeriods', 'Periods not closed', '/month-end'],
];

export function CloseoutPage() {
  const projectId = useProjectId();
  const { can, project } = useAuth();
  const qc = useQueryClient();
  const [lessons, setLessons] = useState<string | null>(null);
  const [na, setNa] = useState<string | null>(null);
  const [archive, setArchive] = useState(false);
  const q = useQuery({ queryKey: ['p', 'closeout', projectId], queryFn: () => api.get<CloseoutResp>(`/projects/${projectId}/closeout`) });
  const inv = () => void qc.invalidateQueries({ queryKey: ['p'] });
  const start = useMutation({ mutationFn: () => api.post(`/projects/${projectId}/closeout/start`), onSuccess: () => { toast.success('Closeout started'); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const setItem = useMutation({ mutationFn: ({ key, status, note }: { key: string; status: string; note?: string }) => api.post(`/projects/${projectId}/closeout/items/${key}`, { status, note }), onSuccess: () => { setNa(null); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const saveLessons = useMutation({ mutationFn: () => api.patch(`/projects/${projectId}/closeout`, { lessonsLearned: lessons }), onSuccess: () => { toast.success('Lessons learned saved'); setLessons(null); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const submit = useMutation({ mutationFn: () => api.post(`/projects/${projectId}/closeout/submit`), onSuccess: () => { toast.success('Closeout submitted for approval'); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const archiveM = useMutation({ mutationFn: () => api.post(`/projects/${projectId}/closeout/archive`), onSuccess: () => { toast.success('Project archived'); setArchive(false); inv(); }, onError: (e: Error) => toast.error(e.message) });
  if (!can('closeout.view')) return <Page><PermissionDenied /></Page>;
  if (q.isLoading) return <Page><LoadingBlock rows={8} /></Page>;
  if (q.error || !q.data) return <Page><ErrorState error={q.error} /></Page>;
  const { closeout: c, finalCost: fc, byCategory, indicators } = q.data;
  const cur = project?.currency;
  const editable = !!c && ['IN_PROGRESS', 'RETURNED'].includes(c.status) && can('closeout.manage');
  const done = c?.items.filter((i) => i.status !== 'PENDING').length ?? 0;
  const total = c?.items.length ?? 0;
  const blockers = INDICATORS.filter(([k]) => (indicators[k] ?? 0) > 0);
  return (
    <Page>
      <PageHeader
        title={<span className="flex items-center gap-3">Project closeout {c && <StatusBadge status={c.status} />}</span>}
        subtitle="Final accounts, retention, stock, handover and lessons learned. Approval follows the CLOSEOUT workflow; an approved closeout can be archived."
        actions={
          <>
            {!c && can('closeout.manage') && <Button icon={<Flag className="h-4 w-4" />} loading={start.isPending} onClick={() => start.mutate()}>Start closeout</Button>}
            {editable && <Button icon={<Send className="h-4 w-4" />} disabled={done < total} title={done < total ? 'Complete or mark every item not applicable first' : undefined} loading={submit.isPending} onClick={() => submit.mutate()}>Submit for approval</Button>}
            {c?.status === 'APPROVED' && can('closeout.approve') && <Button variant="outline" icon={<Archive className="h-4 w-4" />} onClick={() => setArchive(true)}>Archive project</Button>}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Approved budget" value={formatMoney(fc.approvedBudget, cur)} />
        <KpiCard label="Final cost to date (incurred)" value={formatMoney(fc.incurred, cur)} />
        <KpiCard label="Open commitments" value={formatMoney(fc.openCommitments, cur)} tone={Number(fc.openCommitments) > 0 ? 'warning' : 'success'} />
        <KpiCard label="Variance (BAC − EAC)" value={formatMoney(fc.costVariance, cur)} tone={Number(fc.costVariance) < 0 ? 'danger' : 'success'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {!c ? (
            <EmptyState title="Closeout not started" description="Starting creates the closeout checklist. Live indicators on the right show what is still open." />
          ) : (
            <Card title="Closeout checklist" subtitle={`${done} of ${total} complete`} actions={<div className="w-40"><ProgressBar value={total ? (done / total) * 100 : 0} tone={done === total ? 'success' : 'primary'} /></div>}>
              <ul className="divide-y divide-line">
                {c.items.map((i) => (
                  <li key={i.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-start gap-2">
                      {i.status === 'DONE' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : i.status === 'NOT_APPLICABLE' ? <MinusCircle className="mt-0.5 h-4 w-4 text-amber-600" /> : <CircleDashed className="mt-0.5 h-4 w-4 text-slate-400" />}
                      <div>
                        <p className="text-sm">{i.label}</p>
                        {(i.note || i.completedAt) && <p className="text-xs text-muted">{i.note}{i.completedAt && ` · ${formatDateTime(i.completedAt)}`}</p>}
                      </div>
                    </div>
                    {editable && (
                      <div className="flex gap-1">
                        {i.status !== 'DONE' && <Button size="sm" variant="success" onClick={() => setItem.mutate({ key: i.key, status: 'DONE' })}>Done</Button>}
                        {i.status !== 'NOT_APPLICABLE' && <Button size="sm" variant="outline" onClick={() => setNa(i.key)}>N/A</Button>}
                        {i.status !== 'PENDING' && <Button size="sm" variant="ghost" onClick={() => setItem.mutate({ key: i.key, status: 'PENDING' })}>Undo</Button>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {c && (
            <Card title="Lessons learned">
              <Textarea rows={6} aria-label="Lessons learned" disabled={!editable} value={lessons ?? c.lessonsLearned ?? ''} onChange={(e) => setLessons(e.target.value)} placeholder="What went well, what to change on the next project, estimating accuracy, supplier and subcontractor notes…" />
              {editable && <div className="mt-2 flex justify-end"><Button size="sm" disabled={lessons === null} loading={saveLessons.isPending} onClick={() => saveLessons.mutate()}>Save</Button></div>}
            </Card>
          )}
          <Card title="Final cost by category" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-50 text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">Budget</th>
                    <th className="px-3 py-2 text-right">Incurred</th>
                    <th className="px-3 py-2 text-right">Committed</th>
                    <th className="px-3 py-2 text-right">EAC</th>
                    <th className="px-3 py-2 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {byCategory.map(({ category, position: p }) => (
                    <tr key={category} className="border-t border-line">
                      <td className="px-3 py-1.5">{humanize(category)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(p.approvedBudget, cur)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(p.incurred, cur)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(p.openCommitments, cur)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(p.eac, cur)}</td>
                      <td className={cx('px-3 py-1.5 text-right tabular-nums', Number(p.costVariance) < 0 && 'font-semibold text-red-600')}>{formatMoney(p.costVariance, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Open items (live)" subtitle={blockers.length ? 'These should be resolved before final closeout.' : 'No open items detected.'}>
            <DescriptionList
              columns={2}
              items={INDICATORS.map(([k, label, to]) => ({
                label,
                value: <Link to={to} className={cx('font-semibold hover:underline', (indicators[k] ?? 0) > 0 ? 'text-amber-700' : 'text-emerald-700')}>{indicators[k] ?? 0}</Link>,
              }))}
            />
          </Card>
          {c && (
            <Card title="Approval">
              <ApprovalTimeline docType="CLOSEOUT" entityId={c.id} onChanged={() => q.refetch()} />
            </Card>
          )}
          {c?.archivedAt && <p className="text-sm text-muted">Archived {formatDateTime(c.archivedAt)}</p>}
        </div>
      </div>
      <ConfirmDialog open={!!na} onOpenChange={(o) => !o && setNa(null)} title="Mark item not applicable" message="Explain why this item does not apply to the project." requireReason reasonLabel="Note" confirmLabel="Mark N/A" onConfirm={(note) => na && setItem.mutate({ key: na, status: 'NOT_APPLICABLE', note })} />
      <ConfirmDialog open={archive} onOpenChange={setArchive} title="Archive project?" message="The project becomes read-only history. This is recorded in the audit trail." confirmLabel="Archive" tone="danger" loading={archiveM.isPending} onConfirm={() => archiveM.mutate()} />
    </Page>
  );
}
