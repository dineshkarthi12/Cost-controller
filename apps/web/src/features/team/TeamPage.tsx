import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Plus, Trash2 } from 'lucide-react';
import { humanize } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { Badge, Button, Card, Dialog, Field, Input, LoadingBlock, PermissionDenied, TabPanel, Tabs } from '../../components/ui';
import { DataTable } from '../../components/data/DataTable';
import { RefSelect } from '../../components/forms/RefSelect';
import { ChartCard, ChartTooltip, GRID, SERIES, axisProps } from '../../components/data/charts';
import { Page, PageHeader } from '../../components/layout/AppShell';

interface Workload {
  userId: string;
  name: string;
  designation: string | null;
  projectRole: string | null;
  open: number;
  overdue: number;
  reviewBacklog: number;
  blocked: number;
  completedLast30: number;
  openEffortHours: string;
}

interface Raci {
  id: string;
  projectId: string | null;
  processType: string;
  responsibleId: string | null;
  accountableId: string | null;
  reviewerId: string | null;
  approverId: string | null;
  backupId: string | null;
  escalationUserId: string | null;
  slaHours: number | null;
  notes: string | null;
  names: Record<string, string | null>;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  employeeId: string | null;
  designation: string | null;
  department: string | null;
  status: string;
  skills: string[];
  responsibilities: string | null;
  reportingManagerId: string | null;
  backupUserId: string | null;
  memberships: Array<{ projectId: string; project: { code: string } }>;
  roles: Array<{ role: { name: string } }>;
}

/** Editable responsibility templates from the brief — combine for 3–4 person teams. */
export const RESPONSIBILITY_TEMPLATES = [
  { role: 'Cost Control Lead', items: ['Overall project cost', 'Budget and forecast', 'Cost variance', 'Management reporting', 'High-risk cost decisions', 'Final review of cost reports'] },
  { role: 'Manpower & Daily Reporting Coordinator', items: ['MPR', 'Attendance', 'Labour cost', 'Daily site diary', 'DPR', 'Manpower evidence'] },
  { role: 'Material & Procurement Coordinator', items: ['MR and PR', 'PO follow-up', 'GRN', 'Material inspection', 'Stock and consumption', 'Supplier reconciliation'] },
  { role: 'BOQ & Measurement Coordinator', items: ['BOQ', 'Quantity takeoff', 'MB and JMR', 'Measurement verification', 'Work progress quantities', 'Evidence linkage'] },
  { role: 'Billing & Commercial Coordinator', items: ['Contractor bills', 'Client bills', 'Invoices', 'Retention', 'Payment tracking', 'Cash flow and receivables'] },
];

const PROCESSES = ['MPR', 'DPR', 'MR', 'PR', 'PO', 'GRN', 'MIR', 'MB', 'JMR', 'CONTRACTOR_BILL', 'CLIENT_BILL', 'SUPPLIER_INVOICE', 'EXPENSE', 'VARIATION', 'BUDGET_REVISION', 'COST_REPORT', 'FORECAST', 'PERIOD_CLOSE', 'STOCK_RECONCILIATION', 'DOCUMENT_CONTROL'];

const ROLE_KEYS: Array<[keyof Raci, string]> = [
  ['responsibleId', 'Responsible'],
  ['accountableId', 'Accountable'],
  ['reviewerId', 'Reviewer'],
  ['approverId', 'Approver'],
  ['backupId', 'Backup'],
  ['escalationUserId', 'Escalation'],
];

export function TeamPage() {
  const projectId = useProjectId();
  const { can, project } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('workload');
  const [edit, setEdit] = useState<Partial<Raci> | null>(null);
  const workload = useQuery({ queryKey: ['p', 'workload', projectId], queryFn: () => api.get<Workload[]>(`/projects/${projectId}/tasks/workload`) });
  const raci = useQuery({ queryKey: ['p', 'raci', projectId], queryFn: () => api.get<Raci[]>('/admin/responsibility', { projectId }), enabled: tab === 'raci' });
  const users = useQuery({ queryKey: ['users-directory'], queryFn: () => api.get<UserRow[]>('/admin/users'), enabled: tab === 'people' });
  const save = useMutation({
    mutationFn: () => api.put('/admin/responsibility', { ...edit, projectId, slaHours: edit?.slaHours ? Number(edit.slaHours) : null, names: undefined, id: undefined }),
    onSuccess: () => { toast.success('Responsibility saved'); setEdit(null); void qc.invalidateQueries({ queryKey: ['p', 'raci'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/admin/responsibility/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['p', 'raci'] }), onError: (e: Error) => toast.error(e.message) });
  if (!can('team.view')) return <Page><PermissionDenied /></Page>;
  return (
    <Page>
      <PageHeader title="Team management & work allocation" subtitle={`Who owns what on ${project?.name ?? 'this project'}. Membership and access are managed on the project page.`} actions={<Link to={`/projects/${projectId}`}><Button variant="outline">Members & access</Button></Link>} />
      <Card bodyClassName="p-0">
        <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'workload', label: 'Workload' }, { value: 'raci', label: 'Responsibility matrix' }, { value: 'people', label: 'Team profiles' }, { value: 'templates', label: 'Role templates' }]} className="px-4 pt-1">
          <TabPanel value="workload" className="space-y-4 py-4">
            {workload.isLoading && <LoadingBlock rows={4} />}
            {workload.data && (
              <ChartCard
                title="Open tasks by member"
                legend={[{ label: 'Open (not overdue)', color: SERIES[0] }, { label: 'Overdue', color: SERIES[7] }, { label: 'Completed (30 days)', color: SERIES[2] }]}
                table={{ columns: ['Member', 'Open', 'Overdue', 'Completed 30d', 'Review backlog'], rows: workload.data.map((w) => [w.name, w.open, w.overdue, w.completedLast30, w.reviewBacklog]) }}
                chart={
                  <div className="h-60">
                    <ResponsiveContainer>
                      <BarChart data={workload.data.map((w) => ({ name: w.name.split(' ')[0], Open: w.open - w.overdue, Overdue: w.overdue, Completed: w.completedLast30 }))} margin={{ left: 0, right: 8, top: 4 }}>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="name" {...axisProps} />
                        <YAxis allowDecimals={false} {...axisProps} width={32} />
                        <Tooltip content={<ChartTooltip money={false} />} cursor={{ fill: '#f1f4f9' }} />
                        <Bar dataKey="Open" name="Open (not overdue)" stackId="a" fill={SERIES[0]} maxBarSize={28} />
                        <Bar dataKey="Overdue" stackId="a" fill={SERIES[7]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                        <Bar dataKey="Completed" name="Completed (30 days)" fill={SERIES[2]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                }
              />
            )}
            <DataTable
              rows={workload.data}
              rowKey={(r) => r.userId}
              columns={[
                { key: 'name', header: 'Member', cell: (r) => <span><span className="block font-medium">{r.name}</span><span className="text-xs text-muted">{r.projectRole ?? r.designation}</span></span> },
                { key: 'open', header: 'Open', align: 'right', cell: (r) => r.open },
                { key: 'overdue', header: 'Overdue', align: 'right', cell: (r) => <span className={r.overdue ? 'font-semibold text-red-600' : ''}>{r.overdue}</span> },
                { key: 'blocked', header: 'Blocked', align: 'right', cell: (r) => r.blocked },
                { key: 'review', header: 'Review backlog', align: 'right', cell: (r) => r.reviewBacklog },
                { key: 'effort', header: 'Open effort (h)', align: 'right', cell: (r) => Number(r.openEffortHours).toFixed(1) },
                { key: 'done', header: 'Done (30d)', align: 'right', cell: (r) => r.completedLast30 },
              ]}
            />
          </TabPanel>
          <TabPanel value="raci" className="py-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm text-muted">Per process: who does it, who is accountable, who reviews and approves, the backup, SLA and escalation. Organisation defaults apply where no project row exists.</p>
              {can('team.manage') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ processType: 'MPR' })}>Add process</Button>}
            </div>
            {raci.isLoading && <LoadingBlock rows={4} />}
            <DataTable
              rows={raci.data}
              rowKey={(r) => r.id}
              onRowClick={can('team.manage') ? (r) => setEdit(r) : undefined}
              empty={{ title: 'No responsibilities defined' }}
              columns={[
                { key: 'p', header: 'Process', cell: (r) => <span className="font-medium">{humanize(r.processType)} {!r.projectId && <Badge>Org default</Badge>}</span> },
                ...ROLE_KEYS.map(([k, label]) => ({ key: k, header: label, cell: (r: Raci) => r.names[k] ?? '—', hideOnMobile: k !== 'responsibleId' })),
                { key: 'sla', header: 'SLA', align: 'right' as const, cell: (r: Raci) => (r.slaHours ? `${r.slaHours}h` : '—') },
                { key: 'x', header: '', cell: (r: Raci) => can('team.manage') && r.projectId && <Button size="sm" variant="ghost" aria-label="Delete" icon={<Trash2 className="h-4 w-4 text-red-600" />} onClick={(e) => { e.stopPropagation(); del.mutate(r.id); }} /> },
              ]}
            />
          </TabPanel>
          <TabPanel value="people" className="py-4">
            {users.isLoading && <LoadingBlock rows={4} />}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {users.data
                ?.filter((u) => u.memberships.some((m) => m.projectId === projectId))
                .map((u) => (
                  <div key={u.id} className="card p-4">
                    <p className="font-semibold">{u.name}</p>
                    <p className="text-xs text-muted">{u.designation} · {u.employeeId} · {u.department}</p>
                    <div className="mt-2 flex flex-wrap gap-1">{u.roles.map((r, i) => <Badge key={i} tone="primary">{r.role.name}</Badge>)}</div>
                    {u.responsibilities && <p className="mt-2 text-sm">{u.responsibilities}</p>}
                    {u.skills.length > 0 && <p className="mt-2 text-xs text-muted">Skills: {u.skills.join(', ')}</p>}
                    <p className="mt-2 text-xs text-muted">
                      Manager: {users.data?.find((x) => x.id === u.reportingManagerId)?.name ?? '—'} · Backup: {users.data?.find((x) => x.id === u.backupUserId)?.name ?? '—'}
                    </p>
                  </div>
                ))}
            </div>
          </TabPanel>
          <TabPanel value="templates" className="py-4">
            <p className="mb-3 text-sm text-muted">Suggested structure for a 3–5 person cost control team. Responsibilities can be combined for smaller teams; assign them in the responsibility matrix.</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {RESPONSIBILITY_TEMPLATES.map((t) => (
                <div key={t.role} className="card p-4">
                  <p className="font-semibold text-navy-800">{t.role}</p>
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">{t.items.map((i) => <li key={i}>{i}</li>)}</ul>
                </div>
              ))}
            </div>
          </TabPanel>
        </Tabs>
      </Card>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title="Responsibility" footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Process" className="sm:col-span-2">
              <select className="input" value={edit.processType} onChange={(e) => setEdit({ ...edit, processType: e.target.value })}>
                {PROCESSES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
              </select>
            </Field>
            {ROLE_KEYS.map(([k, label]) => (
              <Field key={k} label={label}>
                <RefSelect source="users" value={(edit[k] as string) ?? null} initialLabel={edit.names?.[k] ?? undefined} onChange={(v) => setEdit({ ...edit, [k]: v })} />
              </Field>
            ))}
            <Field label="SLA (hours)">
              <Input inputMode="numeric" value={edit.slaHours ?? ''} onChange={(e) => setEdit({ ...edit, slaHours: e.target.value ? Number(e.target.value) : null })} />
            </Field>
          </div>
        )}
      </Dialog>
    </Page>
  );
}
