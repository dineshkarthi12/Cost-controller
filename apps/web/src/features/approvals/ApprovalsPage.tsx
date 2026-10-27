import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, CornerUpLeft, Plus, XCircle } from 'lucide-react';
import { DEFAULT_DOC_TYPES } from '@toprock/shared';
import { api, type Paged } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatDateTime, formatMoneyCompact, humanize, relativeTime, todayIso } from '../../lib/format';
import { Badge, Button, Card, Dialog, Field, Input, Select, StatusBadge, TabPanel, Tabs, Textarea } from '../../components/ui';
import { DataTable } from '../../components/data/DataTable';
import { RefSelect } from '../../components/forms/RefSelect';
import { Page, PageHeader } from '../../components/layout/AppShell';

interface ApprovalRow {
  id: string;
  docType: string;
  title: string;
  entityId: string;
  amount: string | null;
  status: string;
  submittedAt: string;
  completedAt: string | null;
  submittedByName: string | null;
  currentStepName: string | null;
  dueAt: string | null;
  overdue: boolean;
  link: string | null;
  project: { code: string; name: string } | null;
  onBehalfOf?: string | null;
  selfSubmitted?: boolean;
}

interface Delegation {
  id: string;
  fromName: string;
  toName: string;
  fromUserId: string;
  startDate: string;
  endDate: string;
  docTypes: string[];
  reason: string | null;
  isActive: boolean;
}

const docName = (c: string) => DEFAULT_DOC_TYPES.find((d) => d.code === c)?.name ?? humanize(c);

export function ApprovalsPage() {
  const { me, projectId, setProjectId } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState('inbox');
  const [status, setStatus] = useState('');
  const [docType, setDocType] = useState('');
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState<'project' | 'all'>('all');
  const [decide, setDecide] = useState<{ row: ApprovalRow; action: 'approve' | 'return' | 'reject' } | null>(null);
  const [comment, setComment] = useState('');
  const [delegate, setDelegate] = useState(false);
  const [dForm, setDForm] = useState<{ toUserId: string | null; startDate: string; endDate: string; reason: string }>({ toUserId: null, startDate: todayIso(), endDate: todayIso(), reason: '' });
  const inbox = useQuery({ queryKey: ['approvals', 'inbox', scope === 'project' ? projectId : 'all'], queryFn: () => api.get<ApprovalRow[]>('/approvals/inbox', scope === 'project' ? { projectId } : undefined) });
  const history = useQuery({ queryKey: ['approvals', 'history', status, docType, page], queryFn: () => api.get<Paged<ApprovalRow>>('/approvals', { status, docType, page }), enabled: tab === 'history' });
  const mine = useQuery({ queryKey: ['approvals', 'mine'], queryFn: () => api.get<Paged<ApprovalRow>>('/approvals', { mine: true, pageSize: 50 }), enabled: tab === 'mine' });
  const delegations = useQuery({ queryKey: ['approvals', 'delegations'], queryFn: () => api.get<Delegation[]>('/approvals/delegations/mine'), enabled: tab === 'delegations' });
  const act = useMutation({
    mutationFn: () => api.post(`/approvals/${decide!.row.id}/${decide!.action}`, { comment: comment || undefined }),
    onSuccess: () => {
      toast.success(decide!.action === 'approve' ? 'Approved' : decide!.action === 'return' ? 'Returned for correction' : 'Rejected');
      setDecide(null);
      setComment('');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['p'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveDelegation = useMutation({ mutationFn: () => api.post('/approvals/delegations', dForm), onSuccess: () => { toast.success('Delegation created'); setDelegate(false); void qc.invalidateQueries({ queryKey: ['approvals', 'delegations'] }); }, onError: (e: Error) => toast.error(e.message) });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/approvals/delegations/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['approvals', 'delegations'] }) });

  const open = (r: ApprovalRow) => {
    if (!r.link) return;
    if (r.project && me?.projects.find((p) => p.code === r.project!.code)?.id !== projectId) {
      const pid = me?.projects.find((p) => p.code === r.project!.code)?.id;
      if (pid) setProjectId(pid);
    }
    navigate(r.link);
  };

  const cols = [
    { key: 'title', header: 'Document', cell: (r: ApprovalRow) => <span><span className="block font-medium text-navy-800">{r.title}</span><span className="text-xs text-muted">{docName(r.docType)}{r.project ? ` · ${r.project.code}` : ''}</span></span> },
    { key: 'amount', header: 'Amount', align: 'right' as const, cell: (r: ApprovalRow) => (r.amount ? formatMoneyCompact(r.amount) : '—') },
    { key: 'step', header: 'Step', cell: (r: ApprovalRow) => r.currentStepName ?? '—', hideOnMobile: true },
    { key: 'by', header: 'Submitted', cell: (r: ApprovalRow) => <span className="text-xs">{r.submittedByName}<br /><span className="text-muted">{relativeTime(r.submittedAt)}</span></span>, hideOnMobile: true },
  ];

  return (
    <Page>
      <PageHeader title="Approvals & workflow" subtitle="Documents are approved only through these steps — editing a record or completing a task never approves it." />
      <Card bodyClassName="p-0">
        <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'inbox', label: 'My inbox', count: inbox.data?.length }, { value: 'mine', label: 'Submitted by me' }, { value: 'history', label: 'All requests' }, { value: 'delegations', label: 'Delegations' }]} className="px-4 pt-1">
          <TabPanel value="inbox" className="py-3">
            <div className="mb-2 flex justify-end">
              <Select className="w-48" aria-label="Scope" options={[{ value: 'all', label: 'All my projects' }, { value: 'project', label: 'Current project only' }]} value={scope} onChange={(e) => setScope(e.target.value as 'project' | 'all')} />
            </div>
            <DataTable
              rows={inbox.data}
              loading={inbox.isLoading}
              error={inbox.error}
              rowKey={(r) => r.id}
              onRowClick={open}
              empty={{ title: 'Nothing awaiting your approval', description: 'Requests routed to your role or delegated to you will appear here.' }}
              columns={[
                ...cols,
                { key: 'due', header: 'Due', cell: (r) => (r.overdue ? <Badge tone="danger">Overdue</Badge> : <span className="text-xs text-muted">{formatDateTime(r.dueAt)}</span>) },
                {
                  key: 'actions',
                  header: '',
                  cell: (r) => (
                    <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      {r.selfSubmitted ? (
                        <Badge>Submitted by you</Badge>
                      ) : (
                        <>
                          <Button size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setDecide({ row: r, action: 'approve' })}>Approve</Button>
                          <Button size="sm" variant="outline" aria-label="Return for correction" icon={<CornerUpLeft className="h-4 w-4" />} onClick={() => setDecide({ row: r, action: 'return' })} />
                          <Button size="sm" variant="outline" aria-label="Reject" icon={<XCircle className="h-4 w-4 text-red-600" />} onClick={() => setDecide({ row: r, action: 'reject' })} />
                        </>
                      )}
                    </span>
                  ),
                },
              ]}
              mobileCard={(r) => (
                <div>
                  <p className="font-medium text-navy-800">{r.title}</p>
                  <p className="text-xs text-muted">{r.currentStepName} · {r.amount ? formatMoneyCompact(r.amount) : ''} {r.overdue ? '· overdue' : ''}</p>
                </div>
              )}
            />
          </TabPanel>
          <TabPanel value="mine" className="py-3">
            <DataTable rows={mine.data?.items} loading={mine.isLoading} rowKey={(r) => r.id} onRowClick={open} columns={[...cols, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }]} empty={{ title: 'You have not submitted anything yet' }} />
          </TabPanel>
          <TabPanel value="history" className="py-3">
            <div className="mb-2 flex flex-wrap gap-2">
              <Select className="w-44" aria-label="Status" options={['PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED']} placeholder="All statuses" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
              <Select className="w-64" aria-label="Document type" options={DEFAULT_DOC_TYPES.filter((d) => d.workflow).map((d) => ({ value: d.code, label: d.name }))} placeholder="All document types" value={docType} onChange={(e) => { setDocType(e.target.value); setPage(1); }} />
            </div>
            <DataTable rows={history.data?.items} loading={history.isLoading} rowKey={(r) => r.id} onRowClick={open} columns={[...cols, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'done', header: 'Completed', cell: (r) => formatDate(r.completedAt), hideOnMobile: true }]} pagination={history.data ? { page, pageSize: history.data.pageSize, total: history.data.total, onPage: setPage } : undefined} />
          </TabPanel>
          <TabPanel value="delegations" className="py-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm text-muted">Delegate your approvals while away. Delegates still need the approve permission for the module; actions are recorded as “on behalf of”.</p>
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setDelegate(true)}>New delegation</Button>
            </div>
            <DataTable
              rows={delegations.data}
              loading={delegations.isLoading}
              rowKey={(r) => r.id}
              empty={{ title: 'No delegations' }}
              columns={[
                { key: 'from', header: 'From', cell: (r) => r.fromName },
                { key: 'to', header: 'To', cell: (r) => r.toName },
                { key: 'period', header: 'Period', cell: (r) => `${formatDate(r.startDate)} – ${formatDate(r.endDate)}` },
                { key: 'types', header: 'Documents', cell: (r) => (r.docTypes.length ? r.docTypes.join(', ') : 'All') },
                { key: 'active', header: 'Status', cell: (r) => <StatusBadge status={r.isActive ? 'ACTIVE' : 'CANCELLED'} label={r.isActive ? 'Active' : 'Revoked'} /> },
                { key: 'x', header: '', cell: (r) => r.isActive && r.fromUserId === me?.user.id && <Button size="sm" variant="ghost" onClick={() => revoke.mutate(r.id)}>Revoke</Button> },
              ]}
            />
          </TabPanel>
        </Tabs>
      </Card>
      <Dialog
        open={!!decide}
        onOpenChange={(o) => !o && setDecide(null)}
        title={decide?.action === 'approve' ? 'Approve' : decide?.action === 'return' ? 'Return for correction' : 'Reject'}
        description={decide?.row.title}
        footer={<Button variant={decide?.action === 'reject' ? 'danger' : decide?.action === 'approve' ? 'success' : 'primary'} loading={act.isPending} disabled={decide?.action !== 'approve' && !comment.trim()} onClick={() => act.mutate()}>Confirm</Button>}
      >
        <Field label={decide?.action === 'approve' ? 'Comment (optional)' : 'Reason'} required={decide?.action !== 'approve'}>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
        </Field>
        {decide?.row.link && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => open(decide.row)}>
            Open the document first
          </Button>
        )}
      </Dialog>
      <Dialog open={delegate} onOpenChange={setDelegate} title="Delegate approvals" footer={<Button loading={saveDelegation.isPending} disabled={!dForm.toUserId} onClick={() => saveDelegation.mutate()}>Save</Button>}>
        <div className="space-y-3">
          <Field label="Delegate to" required>
            <RefSelect source="users" value={dForm.toUserId} onChange={(v) => setDForm({ ...dForm, toUserId: v })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <Input type="date" value={dForm.startDate} onChange={(e) => setDForm({ ...dForm, startDate: e.target.value })} />
            </Field>
            <Field label="To">
              <Input type="date" value={dForm.endDate} onChange={(e) => setDForm({ ...dForm, endDate: e.target.value })} />
            </Field>
          </div>
          <Field label="Reason">
            <Input value={dForm.reason} onChange={(e) => setDForm({ ...dForm, reason: e.target.value })} />
          </Field>
        </div>
      </Dialog>
    </Page>
  );
}
