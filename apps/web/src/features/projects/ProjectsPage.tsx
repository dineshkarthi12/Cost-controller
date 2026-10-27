import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, UserMinus, UserPlus } from 'lucide-react';
import { DEFAULT_ROLES, PROJECT_STATUS } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatMoney, formatMoneyCompact, humanize } from '../../lib/format';
import { Badge, Button, Card, DescriptionList, Dialog, ErrorState, Field, Input, LoadingBlock, PermissionDenied, ProgressBar, Select, StatusBadge, Textarea, TabPanel, Tabs } from '../../components/ui';
import { DataTable } from '../../components/data/DataTable';
import { RefSelect } from '../../components/forms/RefSelect';
import { Page, PageHeader } from '../../components/layout/AppShell';

interface ProjectRow {
  id: string;
  code: string;
  name: string;
  status: string;
  location: string | null;
  currency: string;
  contractValue: string;
  approvedBudget: string;
  eac: string;
  incurred: string;
  costVariance: string;
  alert: string;
  physicalProgress: string | null;
  isDemo: boolean;
  client: { name: string } | null;
  projectManager: { name: string } | null;
}

type ProjectForm = Record<string, string>;

const EMPTY: ProjectForm = { code: '', name: '', description: '', location: '', clientId: '', consultantId: '', projectManagerId: '', startDate: '', plannedCompletionDate: '', contractValue: '0', contractType: 'ITEM_RATE', currency: 'INR', taxRate: '18', retentionPct: '5', advanceReceived: '0', advanceRecoveryPct: '0', status: 'PLANNING', template: 'STANDARD' };

const pct = (v: string) => (v === '' ? undefined : (Number(v) / 100).toFixed(6));

function ProjectFormDialog({ open, onOpenChange, initial, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: ProjectForm; projectId?: string }) {
  const [f, setF] = useState<ProjectForm>(initial ?? EMPTY);
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { ...f, taxRate: pct(f.taxRate), retentionPct: pct(f.retentionPct), advanceRecoveryPct: pct(f.advanceRecoveryPct) };
      for (const k of Object.keys(body)) if (body[k] === '') body[k] = k.endsWith('Id') || k.endsWith('Date') ? null : undefined;
      if (projectId) {
        delete body.code;
        delete body.template;
        return api.patch<{ id: string }>(`/projects/${projectId}`, body);
      }
      return api.post<{ id: string }>('/projects', body);
    },
    onSuccess: async (p) => {
      toast.success(projectId ? 'Project updated' : 'Project created');
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ['projects'] });
      await qc.invalidateQueries({ queryKey: ['p'] });
      await refresh();
      if (!projectId) navigate(`/projects/${p.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={projectId ? 'Edit project' : 'New project'} description={projectId ? undefined : 'The standard template creates a WBS, cost codes, a main store and the first reporting period.'} footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} disabled={!f.name || (!projectId && !f.code)} onClick={() => m.mutate()}>{projectId ? 'Save' : 'Create project'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {!projectId && (
          <Field label="Project code" required help="2–12 capital letters, digits or dashes. Used in document numbers.">
            <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={12} />
          </Field>
        )}
        <Field label="Project name" required className={projectId ? 'sm:col-span-2' : ''}>
          <Input value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Client">
          <RefSelect source="clients" value={f.clientId || null} onChange={(v) => setF({ ...f, clientId: v ?? '' })} />
        </Field>
        <Field label="Consultant">
          <RefSelect source="parties" value={f.consultantId || null} onChange={(v) => setF({ ...f, consultantId: v ?? '' })} />
        </Field>
        <Field label="Project manager">
          <RefSelect source="users" value={f.projectManagerId || null} onChange={(v) => setF({ ...f, projectManagerId: v ?? '' })} />
        </Field>
        <Field label="Location">
          <Input value={f.location} onChange={set('location')} />
        </Field>
        <Field label="Start date">
          <Input type="date" value={f.startDate} onChange={set('startDate')} />
        </Field>
        <Field label="Planned completion">
          <Input type="date" value={f.plannedCompletionDate} onChange={set('plannedCompletionDate')} />
        </Field>
        <Field label="Contract value">
          <Input inputMode="decimal" value={f.contractValue} onChange={set('contractValue')} />
        </Field>
        <Field label="Contract type">
          <Select options={['LUMP_SUM', 'ITEM_RATE', 'COST_PLUS', 'DESIGN_BUILD', 'EPC']} value={f.contractType} onChange={set('contractType')} />
        </Field>
        <Field label="Currency">
          <Select options={['INR', 'USD', 'EUR', 'GBP', 'AED']} value={f.currency} onChange={set('currency')} />
        </Field>
        <Field label="Status">
          <Select options={PROJECT_STATUS} value={f.status} onChange={set('status')} />
        </Field>
        <Field label="Tax rate (%)">
          <Input inputMode="decimal" value={f.taxRate} onChange={set('taxRate')} />
        </Field>
        <Field label="Client retention (%)">
          <Input inputMode="decimal" value={f.retentionPct} onChange={set('retentionPct')} />
        </Field>
        <Field label="Client advance received">
          <Input inputMode="decimal" value={f.advanceReceived} onChange={set('advanceReceived')} />
        </Field>
        <Field label="Advance recovery (%)">
          <Input inputMode="decimal" value={f.advanceRecoveryPct} onChange={set('advanceRecoveryPct')} />
        </Field>
        {!projectId && (
          <Field label="Setup template">
            <Select options={[{ value: 'STANDARD', label: 'Standard WBS & cost codes' }, { value: 'NONE', label: 'Empty project' }]} value={f.template} onChange={set('template')} />
          </Field>
        )}
        <Field label="Description" className="sm:col-span-2">
          <Textarea value={f.description} onChange={set('description')} />
        </Field>
      </div>
    </Dialog>
  );
}

export function ProjectsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['projects', q], queryFn: () => api.get<ProjectRow[]>('/projects', { q }) });
  if (!can('project.view')) return <Page><PermissionDenied /></Page>;
  return (
    <Page>
      <PageHeader title="Projects" subtitle="Portfolio with cost position. You only see projects you are a member of (or all, if your role allows)." actions={can('project.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New project</Button>} />
      <Card bodyClassName="p-0">
        <div className="border-b border-line p-3">
          <Input placeholder="Search by name, code or location…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" aria-label="Search projects" />
        </div>
        <DataTable
          rows={list.data}
          loading={list.isLoading}
          error={list.error}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/projects/${r.id}`)}
          columns={[
            { key: 'code', header: 'Code', cell: (r) => <span className="font-medium text-navy-800">{r.code}</span> },
            { key: 'name', header: 'Project', cell: (r) => <span>{r.name} {r.isDemo && <Badge tone="warning">Demo</Badge>}</span> },
            { key: 'client', header: 'Client', cell: (r) => r.client?.name ?? '—', hideOnMobile: true },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'cv', header: 'Contract', align: 'right', cell: (r) => formatMoneyCompact(r.contractValue, r.currency), hideOnMobile: true },
            { key: 'bac', header: 'Budget', align: 'right', cell: (r) => formatMoneyCompact(r.approvedBudget, r.currency) },
            { key: 'eac', header: 'EAC', align: 'right', cell: (r) => formatMoneyCompact(r.eac, r.currency), hideOnMobile: true },
            { key: 'var', header: 'Variance', align: 'right', cell: (r) => <span className={Number(r.costVariance) < 0 ? 'text-red-600' : 'text-emerald-700'}>{formatMoneyCompact(r.costVariance, r.currency)}</span> },
            { key: 'prog', header: 'Progress', cell: (r) => (r.physicalProgress === null ? '—' : <div className="flex w-28 items-center gap-2"><ProgressBar value={Number(r.physicalProgress)} label={`${r.name} progress`} /><span className="text-xs tabular-nums">{r.physicalProgress}%</span></div>), hideOnMobile: true },
            { key: 'alert', header: 'Cost alert', cell: (r) => <StatusBadge status={r.alert} /> },
          ]}
          empty={{ title: 'No projects', description: 'Create a project or ask to be added as a member.' }}
          mobileCard={(r) => (
            <div className="flex justify-between gap-2">
              <div>
                <p className="font-semibold text-navy-800">{r.code} · {r.name}</p>
                <p className="text-xs text-muted">Budget {formatMoneyCompact(r.approvedBudget, r.currency)} · EAC {formatMoneyCompact(r.eac, r.currency)}</p>
              </div>
              <StatusBadge status={r.alert} />
            </div>
          )}
        />
      </Card>
      {open && <ProjectFormDialog open={open} onOpenChange={setOpen} />}
    </Page>
  );
}

interface ProjectDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  location: string | null;
  currency: string;
  contractType: string;
  contractValue: string;
  approvedVariations: string;
  taxRate: string;
  retentionPct: string;
  advanceReceived: string;
  advanceRecoveryPct: string;
  startDate: string | null;
  plannedCompletionDate: string | null;
  actualCompletionDate: string | null;
  budgetBaselinedAt: string | null;
  closeoutStatus: string;
  isDemo: boolean;
  client: { id: string; name: string } | null;
  consultant: { id: string; name: string } | null;
  projectManager: { id: string; name: string } | null;
  clientId: string | null;
  consultantId: string | null;
  projectManagerId: string | null;
}

interface Member {
  id: string;
  userId: string;
  projectRole: string | null;
  approvalLimit: string | null;
  isActive: boolean;
  user: { id: string; name: string; email: string; designation: string | null; status: string; roles: Array<{ projectId: string | null; role: { code: string; name: string } }> };
}

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const { can, projectId, setProjectId } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [edit, setEdit] = useState(false);
  const [add, setAdd] = useState(false);
  const [member, setMember] = useState<{ userId: string | null; projectRole: string; approvalLimit: string; roleCodes: string[] }>({ userId: null, projectRole: '', approvalLimit: '', roleCodes: [] });
  const p = useQuery({ queryKey: ['projects', id], queryFn: () => api.get<ProjectDetail>(`/projects/${id}`) });
  const members = useQuery({ queryKey: ['projects', id, 'members'], queryFn: () => api.get<Member[]>(`/projects/${id}/members`) });
  const addM = useMutation({ mutationFn: () => api.post(`/projects/${id}/members`, { ...member, approvalLimit: member.approvalLimit || null }), onSuccess: () => { toast.success('Member saved'); setAdd(false); void qc.invalidateQueries({ queryKey: ['projects', id, 'members'] }); }, onError: (e: Error) => toast.error(e.message) });
  const remove = useMutation({ mutationFn: (userId: string) => api.del(`/projects/${id}/members/${userId}`), onSuccess: () => { toast.success('Member removed'); void qc.invalidateQueries({ queryKey: ['projects', id, 'members'] }); }, onError: (e: Error) => toast.error(e.message) });
  if (p.isLoading) return <Page><LoadingBlock rows={6} /></Page>;
  if (p.error || !p.data) return <Page><ErrorState error={p.error} /></Page>;
  const d = p.data;
  const pctv = (v: string) => `${(Number(v) * 100).toFixed(2)}%`;
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: d.code }]}
        title={<span className="flex items-center gap-3">{d.code} · {d.name} <StatusBadge status={d.status} /></span>}
        subtitle={d.location ?? undefined}
        actions={
          <>
            {projectId !== d.id && <Button variant="outline" onClick={() => setProjectId(d.id)}>Switch to this project</Button>}
            {can('project.manage') && <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>Edit</Button>}
          </>
        }
      />
      <Card bodyClassName="p-0">
        <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'team', label: 'Team & access', count: members.data?.filter((m) => m.isActive).length }]} className="px-4 pt-1">
          <TabPanel value="overview" className="py-5">
            <DescriptionList
              items={[
                { label: 'Client', value: d.client?.name },
                { label: 'Consultant', value: d.consultant?.name },
                { label: 'Project manager', value: d.projectManager?.name },
                { label: 'Contract type', value: humanize(d.contractType) },
                { label: 'Contract value', value: formatMoney(d.contractValue, d.currency) },
                { label: 'Approved variations', value: formatMoney(d.approvedVariations, d.currency) },
                { label: 'Revised contract value', value: formatMoney(String(Number(d.contractValue) + Number(d.approvedVariations)), d.currency) },
                { label: 'Currency', value: d.currency },
                { label: 'Tax rate', value: pctv(d.taxRate) },
                { label: 'Client retention', value: pctv(d.retentionPct) },
                { label: 'Client advance', value: formatMoney(d.advanceReceived, d.currency) },
                { label: 'Advance recovery', value: pctv(d.advanceRecoveryPct) },
                { label: 'Start date', value: formatDate(d.startDate) },
                { label: 'Planned completion', value: formatDate(d.plannedCompletionDate) },
                { label: 'Budget baseline', value: d.budgetBaselinedAt ? `Baselined ${formatDate(d.budgetBaselinedAt)}` : 'Not baselined' },
                { label: 'Closeout', value: humanize(d.closeoutStatus) },
                { label: 'Financial period', value: 'Monthly' },
                { label: 'Description', value: d.description, span: 3 },
              ]}
            />
          </TabPanel>
          <TabPanel value="team" className="py-4">
            <div className="mb-3 flex justify-between gap-2">
              <p className="text-sm text-muted">Members can access this project. Project roles add permissions for this project only; approval limits cap what a member can finally authorise.</p>
              {can('team.manage') && <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => { setMember({ userId: null, projectRole: '', approvalLimit: '', roleCodes: [] }); setAdd(true); }}>Add member</Button>}
            </div>
            {members.isLoading && <LoadingBlock rows={3} />}
            <DataTable
              rows={members.data?.filter((m) => m.isActive)}
              rowKey={(r) => r.id}
              columns={[
                { key: 'name', header: 'Name', cell: (r) => <span className="font-medium">{r.user.name}</span> },
                { key: 'role', header: 'Project role', cell: (r) => r.projectRole ?? r.user.designation ?? '—' },
                { key: 'roles', header: 'Access roles', cell: (r) => <span className="flex flex-wrap gap-1">{r.user.roles.map((x, i) => <Badge key={i} tone={x.projectId ? 'primary' : 'neutral'}>{x.role.name}{x.projectId ? ' (project)' : ''}</Badge>)}</span> },
                { key: 'limit', header: 'Approval limit', align: 'right', cell: (r) => (r.approvalLimit ? formatMoneyCompact(r.approvalLimit, d.currency) : 'No limit') },
                { key: 'act', header: '', cell: (r) => can('team.manage') && <span className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => { setMember({ userId: r.userId, projectRole: r.projectRole ?? '', approvalLimit: r.approvalLimit ?? '', roleCodes: r.user.roles.filter((x) => x.projectId).map((x) => x.role.code) }); setAdd(true); }}>Edit</Button><Button size="sm" variant="ghost" className="text-red-600" icon={<UserMinus className="h-4 w-4" />} onClick={() => remove.mutate(r.userId)}>Remove</Button></span> },
              ]}
            />
          </TabPanel>
        </Tabs>
      </Card>
      {edit && <ProjectFormDialog open={edit} onOpenChange={setEdit} projectId={d.id} initial={{ ...EMPTY, name: d.name, description: d.description ?? '', location: d.location ?? '', clientId: d.clientId ?? '', consultantId: d.consultantId ?? '', projectManagerId: d.projectManagerId ?? '', startDate: d.startDate?.slice(0, 10) ?? '', plannedCompletionDate: d.plannedCompletionDate?.slice(0, 10) ?? '', contractValue: d.contractValue, contractType: d.contractType, currency: d.currency, taxRate: String(Number(d.taxRate) * 100), retentionPct: String(Number(d.retentionPct) * 100), advanceReceived: d.advanceReceived, advanceRecoveryPct: String(Number(d.advanceRecoveryPct) * 100), status: d.status }} />}
      <Dialog open={add} onOpenChange={setAdd} title="Project member" footer={<Button loading={addM.isPending} disabled={!member.userId} onClick={() => addM.mutate()}>Save member</Button>}>
        <div className="space-y-3">
          <Field label="User" required>
            <RefSelect source="users" value={member.userId} onChange={(v) => setMember({ ...member, userId: v })} />
          </Field>
          <Field label="Project role / designation">
            <Input value={member.projectRole} onChange={(e) => setMember({ ...member, projectRole: e.target.value })} />
          </Field>
          <Field label="Approval limit" help="Leave blank for no limit. Applies to final authorisation of financial documents.">
            <Input inputMode="decimal" value={member.approvalLimit} onChange={(e) => setMember({ ...member, approvalLimit: e.target.value })} />
          </Field>
          <Field label="Additional roles on this project">
            <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
              {DEFAULT_ROLES.filter((r) => r.code !== 'SUPER_ADMIN').map((r) => (
                <label key={r.code} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={member.roleCodes.includes(r.code)} onChange={(e) => setMember({ ...member, roleCodes: e.target.checked ? [...member.roleCodes, r.code] : member.roleCodes.filter((x) => x !== r.code) })} />
                  {r.name}
                </label>
              ))}
            </div>
          </Field>
        </div>
      </Dialog>
    </Page>
  );
}
