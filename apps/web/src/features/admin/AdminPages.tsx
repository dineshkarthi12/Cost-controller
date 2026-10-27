import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Mail, Pencil, Plug, Plus, RotateCcw, Save, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { DEFAULT_DOC_TYPES, MODULES, MODULE_GROUPS, PERMISSION_AREAS, SPECIAL_PERMISSIONS } from '@toprock/shared';
import { api, type Paged } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, formatMoney, humanize } from '../../lib/format';
import { Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, ErrorState, Field, Input, LoadingBlock, PermissionDenied, Select, StatusBadge, TabPanel, Tabs, Textarea, cx } from '../../components/ui';
import { DataTable } from '../../components/data/DataTable';
import { Page, PageHeader } from '../../components/layout/AppShell';

const err = (e: Error) => toast.error(e.message);

/* ------------------------------------------------------------------ Users & roles */

interface UserRow {
  id: string;
  name: string;
  email: string;
  employeeId: string | null;
  designation: string | null;
  department: string | null;
  phone: string | null;
  status: string;
  mfaEnabled: boolean;
  approvalLimit: string | null;
  lastLoginAt: string | null;
  roles: Array<{ projectId: string | null; role: { code: string; name: string } }>;
  memberships: Array<{ projectId: string; projectRole: string | null; project: { code: string; name: string } }>;
}
interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  _count: { users: number };
}
interface ProjectRow {
  id: string;
  code: string;
  name: string;
}

function useRoles() {
  return useQuery({ queryKey: ['admin', 'roles'], queryFn: () => api.get<{ roles: Role[]; allPermissions: string[] }>('/admin/roles') });
}

export function UsersPage() {
  const [tab, setTab] = useState('users');
  return (
    <Page>
      <PageHeader title="Users & roles" subtitle="Users get organisation roles here and project access on each project's Members tab. Permissions are enforced by the API; the interface only hides what you cannot do." />
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'users', label: 'Users' }, { value: 'roles', label: 'Roles & permissions' }]}>
        <TabPanel value="users" className="pt-4"><UsersTab /></TabPanel>
        <TabPanel value="roles" className="pt-4"><RolesTab /></TabPanel>
      </Tabs>
    </Page>
  );
}

const emptyUser = { name: '', email: '', employeeId: '', designation: '', department: '', phone: '', approvalLimit: '', roleCodes: [] as string[], projectIds: [] as string[] };

function UsersTab() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [edit, setEdit] = useState<{ id: string | null; form: typeof emptyUser } | null>(null);
  const [invited, setInvited] = useState<{ email: string; emailSent: boolean; emailError?: string; inviteLink?: string } | null>(null);
  const [deactivate, setDeactivate] = useState<UserRow | null>(null);
  const users = useQuery({ queryKey: ['admin', 'users', q, status], queryFn: () => api.get<UserRow[]>('/admin/users', { q, status }) });
  const roles = useRoles();
  const projects = useQuery({ queryKey: ['projects-admin'], queryFn: () => api.get<ProjectRow[]>('/projects') });
  const inv = () => void qc.invalidateQueries({ queryKey: ['admin'] });
  const save = useMutation({
    mutationFn: () => {
      const f = edit!.form;
      const body = { name: f.name, employeeId: f.employeeId || null, designation: f.designation || null, department: f.department || null, phone: f.phone || null, approvalLimit: f.approvalLimit || null, roleCodes: f.roleCodes };
      return edit!.id ? api.patch(`/admin/users/${edit!.id}`, body) : api.post<{ inviteLink?: string; emailSent: boolean; emailError?: string }>('/admin/users/invite', { ...body, email: f.email, projectIds: f.projectIds }).then((r) => ({ ...r, email: f.email }));
    },
    onSuccess: (r) => {
      toast.success(edit?.id ? 'User updated' : 'Invitation created');
      if (!edit?.id && r) setInvited(r as { email: string; emailSent: boolean; emailError?: string; inviteLink?: string });
      setEdit(null);
      inv();
    },
    onError: err,
  });
  const action = useMutation({ mutationFn: ({ id, act, reason }: { id: string; act: string; reason?: string }) => api.post(`/admin/users/${id}/${act}`, { reason }), onSuccess: () => { toast.success('Done'); setDeactivate(null); inv(); }, onError: err });
  const f = edit?.form;
  const setF = (p: Partial<typeof emptyUser>) => setEdit((e) => (e ? { ...e, form: { ...e.form, ...p } } : e));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <>
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Input className="w-64" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
          <Select className="w-44" aria-label="Status" options={['ACTIVE', 'INVITED', 'DEACTIVATED', 'LOCKED']} placeholder="All statuses" value={status} onChange={(e) => setStatus(e.target.value)} />
          <Button className="ml-auto" icon={<UserPlus className="h-4 w-4" />} onClick={() => setEdit({ id: null, form: { ...emptyUser } })}>Invite user</Button>
        </div>
        <DataTable
          rows={users.data}
          loading={users.isLoading}
          error={users.error}
          rowKey={(u) => u.id}
          dense
          columns={[
            { key: 'n', header: 'User', cell: (u) => <span><span className="block font-medium">{u.name}</span><span className="text-xs text-muted">{u.email}{u.designation ? ` · ${u.designation}` : ''}</span></span> },
            { key: 'r', header: 'Organisation roles', cell: (u) => <span className="flex flex-wrap gap-1">{u.roles.filter((r) => !r.projectId).map((r) => <Badge key={r.role.code} tone="info">{r.role.name}</Badge>)}</span> },
            { key: 'p', header: 'Projects', cell: (u) => u.memberships.map((m) => m.project.code).join(', ') || '—', hideOnMobile: true },
            { key: 'l', header: 'Approval limit', align: 'right', cell: (u) => (u.approvalLimit ? formatMoney(u.approvalLimit) : <span className="text-muted">Unlimited</span>), hideOnMobile: true },
            { key: 'm', header: 'MFA', cell: (u) => (u.mfaEnabled ? <ShieldCheck className="h-4 w-4 text-emerald-600" aria-label="MFA on" /> : <span className="text-xs text-muted">Off</span>), hideOnMobile: true },
            { key: 'last', header: 'Last login', cell: (u) => formatDateTime(u.lastLoginAt), hideOnMobile: true },
            { key: 's', header: 'Status', cell: (u) => <StatusBadge status={u.status} /> },
            {
              key: 'a',
              header: '',
              align: 'right',
              cell: (u) => (
                <span className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Edit ${u.name}`} icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit({ id: u.id, form: { ...emptyUser, name: u.name, email: u.email, employeeId: u.employeeId ?? '', designation: u.designation ?? '', department: u.department ?? '', phone: u.phone ?? '', approvalLimit: u.approvalLimit ?? '', roleCodes: u.roles.filter((r) => !r.projectId).map((r) => r.role.code) } })} />
                  {u.id !== me?.user.id && (u.status === 'DEACTIVATED' ? <Button size="sm" variant="outline" onClick={() => action.mutate({ id: u.id, act: 'reactivate' })}>Reactivate</Button> : <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDeactivate(u)}>Deactivate</Button>)}
                  <Button size="sm" variant="ghost" title="Sign the user out everywhere" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => action.mutate({ id: u.id, act: 'revoke-sessions' })} aria-label="Revoke sessions" />
                </span>
              ),
            },
          ]}
        />
      </Card>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} size="lg" title={edit?.id ? `Edit ${f?.name}` : 'Invite user'} description={edit?.id ? 'Role changes take effect on the user’s next request.' : 'The user receives a one-time link to set their password. Email delivery is not configured, so share the link securely.'} footer={<Button loading={save.isPending} disabled={!f?.name || (!edit?.id && !f?.email)} onClick={() => save.mutate()}>{edit?.id ? 'Save' : 'Create invitation'}</Button>}>
        {f && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name" required><Input value={f.name} onChange={(e) => setF({ name: e.target.value })} /></Field>
              <Field label="Email" required><Input type="email" value={f.email} disabled={!!edit?.id} onChange={(e) => setF({ email: e.target.value })} /></Field>
              <Field label="Employee ID"><Input value={f.employeeId} onChange={(e) => setF({ employeeId: e.target.value })} /></Field>
              <Field label="Designation"><Input value={f.designation} onChange={(e) => setF({ designation: e.target.value })} /></Field>
              <Field label="Department"><Input value={f.department} onChange={(e) => setF({ department: e.target.value })} /></Field>
              <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ phone: e.target.value })} /></Field>
              <Field label="Approval limit" help="Blank = unlimited. A project-level limit on the Members tab overrides this."><Input inputMode="decimal" value={f.approvalLimit} onChange={(e) => setF({ approvalLimit: e.target.value })} /></Field>
            </div>
            <fieldset>
              <legend className="label mb-1">Organisation roles</legend>
              <div className="grid max-h-48 gap-1 overflow-auto rounded-lg border border-line p-2 sm:grid-cols-2">
                {(roles.data?.roles ?? []).map((r) => <Checkbox key={r.code} label={r.name} checked={f.roleCodes.includes(r.code)} onChange={() => setF({ roleCodes: toggle(f.roleCodes, r.code) })} />)}
              </div>
            </fieldset>
            {!edit?.id && (
              <fieldset>
                <legend className="label mb-1">Project access</legend>
                <div className="grid max-h-40 gap-1 overflow-auto rounded-lg border border-line p-2 sm:grid-cols-2">
                  {(projects.data ?? []).map((p) => <Checkbox key={p.id} label={`${p.code} — ${p.name}`} checked={f.projectIds.includes(p.id)} onChange={() => setF({ projectIds: toggle(f.projectIds, p.id) })} />)}
                </div>
              </fieldset>
            )}
          </div>
        )}
      </Dialog>
      <Dialog open={!!invited} onOpenChange={(o) => !o && setInvited(null)} title={invited?.emailSent ? 'Invitation emailed' : 'Invitation created'}>
        {invited?.emailSent ? (
          <p className="text-sm">An invitation email was sent to <strong>{invited.email}</strong>. The link works once and expires in 7 days.</p>
        ) : invited?.inviteLink ? (
          <div className="space-y-2 text-sm">
            <p>The invitation email could not be sent{invited.emailError ? ` (${invited.emailError})` : ''}. Share this one-time link with the user yourself, for example on WhatsApp. It expires in 7 days.</p>
            <Input readOnly value={invited.inviteLink} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
            <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(invited.inviteLink!).then(() => toast.success('Link copied'))}>Copy link</Button>
          </div>
        ) : null}
      </Dialog>
      <ConfirmDialog open={!!deactivate} onOpenChange={(o) => !o && setDeactivate(null)} title={`Deactivate ${deactivate?.name ?? ''}?`} message="The user is signed out everywhere and cannot sign in. Their records and history remain." requireReason tone="danger" confirmLabel="Deactivate" loading={action.isPending} onConfirm={(reason) => deactivate && action.mutate({ id: deactivate.id, act: 'deactivate', reason })} />
    </>
  );
}

function RolesTab() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const roles = useRoles();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; description: string; permissions: string[] } | null>(null);
  const [creating, setCreating] = useState<{ code: string; name: string } | null>(null);
  const role = roles.data?.roles.find((r) => r.id === selected) ?? roles.data?.roles[0];
  const editable = can('role.manage') && role && role.code !== 'SUPER_ADMIN';
  const perms = draft?.permissions ?? role?.permissions ?? [];
  const inv = () => void qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
  const save = useMutation({ mutationFn: () => api.put(`/admin/roles/${role!.id}`, { name: draft!.name, description: draft!.description || undefined, permissions: draft!.permissions }), onSuccess: () => { toast.success('Role saved'); setDraft(null); inv(); }, onError: err });
  const reset = useMutation({ mutationFn: () => api.post(`/admin/roles/${role!.id}/reset`), onSuccess: () => { toast.success('Reset to defaults'); setDraft(null); inv(); }, onError: err });
  const create = useMutation({ mutationFn: () => api.post<Role>('/admin/roles', { code: creating!.code, name: creating!.name, permissions: [] }), onSuccess: (r) => { toast.success('Role created'); setCreating(null); setSelected(r.id); inv(); }, onError: err });
  const del = useMutation({ mutationFn: () => api.del(`/admin/roles/${role!.id}`), onSuccess: () => { toast.success('Role deleted'); setSelected(null); inv(); }, onError: err });
  if (roles.isLoading) return <LoadingBlock rows={6} />;
  if (roles.error) return <ErrorState error={roles.error} />;
  const togglePerm = (p: string) => {
    const base = draft ?? { name: role!.name, description: role!.description ?? '', permissions: role!.permissions };
    setDraft({ ...base, permissions: base.permissions.includes(p) ? base.permissions.filter((x) => x !== p) : [...base.permissions, p] });
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card bodyClassName="p-0" title="Roles" actions={can('role.manage') && <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating({ code: '', name: '' })}>New</Button>}>
        <ul className="max-h-[60vh] overflow-auto">
          {roles.data!.roles.map((r) => (
            <li key={r.id}>
              <button type="button" className={cx('flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-surface-50', role?.id === r.id && 'bg-brand-50 font-medium text-navy-800')} onClick={() => { setSelected(r.id); setDraft(null); }}>
                <span>{r.name}</span>
                <span className="text-xs text-muted">{r._count.users}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {role && (
        <Card
          title={<span className="flex items-center gap-2">{role.name} {role.isSystem && <Badge tone="neutral">System</Badge>}</span>}
          subtitle={role.code === 'SUPER_ADMIN' ? 'Super Admin always has every permission and cannot be edited.' : `${perms.length} permissions · ${role._count.users} user(s)`}
          actions={
            editable && (
              <>
                {role.isSystem && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} loading={reset.isPending} onClick={() => reset.mutate()}>Reset to defaults</Button>}
                {!role.isSystem && <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="h-4 w-4" />} disabled={role._count.users > 0} title={role._count.users ? 'Unassign users first' : undefined} onClick={() => del.mutate()}>Delete</Button>}
                <Button size="sm" icon={<Save className="h-4 w-4" />} disabled={!draft} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
              </>
            )
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1.5 pr-2">Area</th>
                  {['view', 'manage', 'approve'].map((a) => <th key={a} className="w-20 py-1.5 text-center">{humanize(a)}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.entries(PERMISSION_AREAS).map(([area, label]) => (
                  <tr key={area} className="border-t border-line">
                    <td className="py-1.5 pr-2">{label}</td>
                    {['view', 'manage', 'approve'].map((a) => {
                      const p = `${area}.${a}`;
                      return (
                        <td key={a} className="text-center">
                          <input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={`${label} ${a}`} checked={role.code === 'SUPER_ADMIN' || perms.includes(p)} disabled={!editable} onChange={() => togglePerm(p)} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4 className="mt-4 mb-2 text-sm font-semibold">Special permissions</h4>
          <div className="grid gap-1 sm:grid-cols-2">
            {Object.entries(SPECIAL_PERMISSIONS).map(([p, label]) => <Checkbox key={p} label={label} checked={role.code === 'SUPER_ADMIN' || perms.includes(p)} disabled={!editable} onChange={() => togglePerm(p)} />)}
          </div>
        </Card>
      )}
      <Dialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)} title="New role" footer={<Button loading={create.isPending} disabled={!creating?.code || !creating?.name} onClick={() => create.mutate()}>Create</Button>}>
        {creating && (
          <div className="space-y-3">
            <Field label="Code" required help="Upper case letters, digits and underscores"><Input value={creating.code} onChange={(e) => setCreating({ ...creating, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} /></Field>
            <Field label="Name" required><Input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ Audit */

interface AuditRow {
  id: string;
  createdAt: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  projectId: string | null;
  summary: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}

export function AuditPage() {
  const { me } = useAuth();
  const [filters, setFilters] = useState({ projectId: '', entityType: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const q = useQuery({ queryKey: ['admin', 'audit', filters, page], queryFn: () => api.get<Paged<AuditRow>>('/admin/audit', { ...filters, page, pageSize: 50 }) });
  const set = (p: Partial<typeof filters>) => { setFilters({ ...filters, ...p }); setPage(1); };
  return (
    <Page>
      <PageHeader title="Audit trail" subtitle="Append-only record of who did what, when, and why. Entries cannot be edited or deleted from the application." />
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
          <Field label="Project"><Select options={(me?.projects ?? []).map((p) => ({ value: p.id, label: p.code }))} placeholder="All" value={filters.projectId} onChange={(e) => set({ projectId: e.target.value })} /></Field>
          <Field label="Record type"><Input placeholder="e.g. purchaseOrder" value={filters.entityType} onChange={(e) => set({ entityType: e.target.value })} /></Field>
          <Field label="Action"><Input placeholder="e.g. APPROVE" value={filters.action} onChange={(e) => set({ action: e.target.value.toUpperCase() })} /></Field>
          <Field label="From"><Input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></Field>
        </div>
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          error={q.error}
          rowKey={(r) => r.id}
          dense
          onRowClick={setOpen}
          columns={[
            { key: 't', header: 'When', cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt)}</span> },
            { key: 'u', header: 'Who', cell: (r) => r.actorName },
            { key: 'a', header: 'Action', cell: (r) => <Badge tone="neutral">{r.action}</Badge> },
            { key: 'e', header: 'Record', cell: (r) => <span className="text-xs">{r.entityType}</span>, hideOnMobile: true },
            { key: 's', header: 'Summary', cell: (r) => <span className="text-sm">{r.summary}{r.reason && <span className="block text-xs text-muted">Reason: {r.reason}</span>}</span> },
          ]}
          pagination={q.data ? { page, pageSize: q.data.pageSize, total: q.data.total, onPage: setPage } : undefined}
        />
      </Card>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} size="lg" title={open ? `${open.action} · ${open.entityType}` : ''} description={open ? `${formatDateTime(open.createdAt)} by ${open.actorName}${open.ip ? ` from ${open.ip}` : ''}` : undefined}>
        {open && (
          <div className="space-y-3 text-sm">
            {open.summary && <p>{open.summary}</p>}
            {open.reason && <p><strong>Reason:</strong> {open.reason}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div><p className="label">Before</p><pre className="max-h-72 overflow-auto rounded bg-surface-50 p-2 text-xs">{open.before ? JSON.stringify(open.before, null, 2) : '—'}</pre></div>
              <div><p className="label">After</p><pre className="max-h-72 overflow-auto rounded bg-surface-50 p-2 text-xs">{open.after ? JSON.stringify(open.after, null, 2) : '—'}</pre></div>
            </div>
            <p className="text-xs text-muted">Record ID {open.entityId}</p>
          </div>
        )}
      </Dialog>
    </Page>
  );
}

/* ------------------------------------------------------------------ Integrations */

interface Integration {
  provider: string;
  kind: string;
  name: string;
  fields: string[];
  config: { status: string; config: Record<string, string>; lastTestAt: string | null; lastTestResult: string | null } | null;
}
interface ImportJob {
  id: string;
  kind: string;
  fileName: string;
  status: string;
  summary: { total?: number; valid?: number; invalid?: number; imported?: number; skipped?: number } | null;
  createdAt: string;
  committedAt: string | null;
}

export function IntegrationsPage() {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ provider: string; name: string; fields: string[]; values: Record<string, string> } | null>(null);
  const q = useQuery({ queryKey: ['admin', 'integrations'], queryFn: () => api.get<Integration[]>('/admin/integrations') });
  const jobs = useQuery({ queryKey: ['admin', 'imports'], queryFn: () => api.get<ImportJob[]>('/imports') });
  const save = useMutation({ mutationFn: () => api.put(`/admin/integrations/${edit!.provider}`, { config: edit!.values }), onSuccess: () => { toast.success('Configuration saved (not active)'); setEdit(null); void qc.invalidateQueries({ queryKey: ['admin', 'integrations'] }); }, onError: err });
  const test = useMutation({ mutationFn: (p: string) => api.post<{ lastTestResult: string }>(`/admin/integrations/${p}/test`), onSuccess: (r) => { toast.info(r.lastTestResult); void qc.invalidateQueries({ queryKey: ['admin', 'integrations'] }); }, onError: err });
  const email = useQuery({ queryKey: ['admin', 'email'], queryFn: () => api.get<{ configured: boolean; host?: string; from?: string }>('/admin/email') });
  const emailTest = useMutation({ mutationFn: () => api.post<{ sent: boolean; error?: string; to: string }>('/admin/email/test'), onSuccess: (r) => (r.sent ? toast.success(`Test email sent to ${r.to}. Check the inbox (and spam folder).`) : toast.error(`Test email failed: ${r.error}`)), onError: err });
  return (
    <Page>
      <PageHeader title="Integrations & imports" subtitle="Email is built in. Accounting and ERP connectors are defined as interfaces only and are inactive; data moves through Excel/CSV import and report exports." />
      <Card className="mb-4" title={<span className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted" />Email (SMTP)</span>} subtitle="Invitations, password resets and approval alerts">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          {email.data?.configured ? (
            <span className="flex flex-wrap items-center gap-2"><Badge tone="success">Configured</Badge> Sending from <strong>{email.data.from}</strong> via {email.data.host}</span>
          ) : (
            <span className="flex flex-wrap items-center gap-2"><Badge tone="neutral">Not set up</Badge> Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and optionally EMAIL_FROM) in the hosting settings, then redeploy.</span>
          )}
          <Button size="sm" variant="outline" disabled={!email.data?.configured} loading={emailTest.isPending} onClick={() => emailTest.mutate()}>Send test email to me</Button>
        </div>
      </Card>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {q.isLoading && <LoadingBlock rows={3} />}
        {(q.data ?? []).map((i) => (
          <Card key={i.provider} title={<span className="flex items-center gap-2"><Plug className="h-4 w-4 text-muted" />{i.name}</span>} subtitle={humanize(i.kind)}>
            <div className="space-y-2 text-sm">
              <Badge tone={i.config ? 'warning' : 'neutral'}>{i.config ? 'Configured · not active' : 'Not configured · not active'}</Badge>
              {i.config?.lastTestResult && <p className="text-xs text-muted">{formatDateTime(i.config.lastTestAt)}: {i.config.lastTestResult}</p>}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEdit({ provider: i.provider, name: i.name, fields: i.fields, values: { ...Object.fromEntries(i.fields.map((f) => [f, ''])), ...(i.config?.config ?? {}) } })}>Configure</Button>
                {i.config && <Button size="sm" variant="ghost" loading={test.isPending && test.variables === i.provider} onClick={() => test.mutate(i.provider)}>Test</Button>}
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Card title="Import history" bodyClassName="p-0">
        <DataTable
          rows={jobs.data}
          loading={jobs.isLoading}
          rowKey={(j) => j.id}
          dense
          empty={{ title: 'No imports yet', description: 'Imports run from the BOQ, cost code, material, supplier and inventory pages.' }}
          columns={[
            { key: 'd', header: 'Date', cell: (j) => formatDateTime(j.createdAt) },
            { key: 'k', header: 'Type', cell: (j) => humanize(j.kind) },
            { key: 'f', header: 'File', cell: (j) => j.fileName },
            { key: 'r', header: 'Rows', align: 'right', cell: (j) => (j.summary ? `${j.summary.imported ?? j.summary.valid ?? 0} ok / ${j.summary.skipped ?? j.summary.invalid ?? 0} err` : '—') },
            { key: 's', header: 'Status', cell: (j) => <StatusBadge status={j.status} /> },
            { key: 'e', header: '', cell: (j) => ((j.summary?.invalid ?? 0) > 0 ? <a className="text-xs text-brand-700 underline" href={api.url(`/imports/${j.id}/errors.csv`)}>Error report</a> : null) },
          ]}
        />
      </Card>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={`Configure ${edit?.name ?? ''}`} description="Saving stores non-secret settings only. The integration stays inactive until a connector is implemented and tested end to end." footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Save configuration</Button>}>
        {edit && (
          <div className="space-y-3">
            {edit.fields.map((f) => (
              <Field key={f} label={humanize(f)}>
                <Input value={edit.values[f] ?? ''} onChange={(e) => setEdit({ ...edit, values: { ...edit.values, [f]: e.target.value } })} />
              </Field>
            ))}
          </div>
        )}
      </Dialog>
    </Page>
  );
}

/* ------------------------------------------------------------------ Settings */

interface OrgSettings {
  taxIsCost: boolean;
  manpowerUniqueness: string;
  budgetCheckMode: string;
  priceTolerancePct: string;
  overReceiptTolerancePct: string;
  alertWarnPct: string;
  measurementDuplicateMode: string;
  autoBudgetRevisionFromVariation: boolean;
  visibleModules: string[];
  dataRetentionYears: number;
}
interface SettingsResp {
  org: { id: string; name: string; code: string; baseCurrency: string; timezone: string; isDemo: boolean };
  settings: OrgSettings;
}
interface DocType {
  id: string;
  code: string;
  name: string;
  abbreviation: string;
  numberFormat: string;
  resetPolicy: string;
  requiredAttachments: number;
  isActive: boolean;
  workflow: boolean;
  financial: boolean;
}
interface WfStep {
  stepNo: number;
  name: string;
  approverRoleCode: string | null;
  approverUserId: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  requiredApprovals: number;
  slaHours: number;
  escalateToRoleCode: string | null;
}
interface Workflow {
  id: string;
  docType: string;
  projectId: string | null;
  name: string;
  isActive: boolean;
  allowSelfApproval: boolean;
  steps: WfStep[];
}

export function SettingsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState('general');
  if (!can('settings.manage') && !can('project.view')) return <Page><PermissionDenied /></Page>;
  return (
    <Page>
      <PageHeader title="Settings" subtitle={can('settings.manage') ? 'Organisation-wide rules. Every change is audited.' : 'Read-only: changing settings requires settings.manage.'} />
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'general', label: 'Business rules' }, { value: 'modules', label: 'Modules' }, { value: 'doctypes', label: 'Document numbering' }, { value: 'workflows', label: 'Approval workflows' }]}>
        <TabPanel value="general" className="pt-4"><GeneralSettings /></TabPanel>
        <TabPanel value="modules" className="pt-4"><ModuleSettings /></TabPanel>
        <TabPanel value="doctypes" className="pt-4"><DocTypeSettings /></TabPanel>
        <TabPanel value="workflows" className="pt-4"><WorkflowSettings /></TabPanel>
      </Tabs>
    </Page>
  );
}

function useSettings() {
  return useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<SettingsResp>('/admin/settings') });
}

function GeneralSettings() {
  const { can, refresh } = useAuth();
  const qc = useQueryClient();
  const q = useSettings();
  const [draft, setDraft] = useState<{ name: string; baseCurrency: string; timezone: string; settings: OrgSettings } | null>(null);
  const save = useMutation({ mutationFn: () => api.put('/admin/settings', draft), onSuccess: () => { toast.success('Settings saved'); setDraft(null); void qc.invalidateQueries({ queryKey: ['admin', 'settings'] }); void refresh(); }, onError: err });
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const d = draft ?? { name: q.data.org.name, baseCurrency: q.data.org.baseCurrency, timezone: q.data.org.timezone, settings: q.data.settings };
  const ro = !can('settings.manage');
  const set = (p: Partial<typeof d>) => setDraft({ ...d, ...p });
  const ss = (p: Partial<OrgSettings>) => set({ settings: { ...d.settings, ...p } });
  const pct = (v: string) => String(Math.round(Number(v) * 10000) / 100);
  const frac = (v: string) => String(Number(v || 0) / 100);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Organisation">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={d.name} disabled={ro} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Code"><Input value={q.data.org.code} disabled /></Field>
          <Field label="Base currency"><Select options={['INR', 'USD', 'EUR', 'GBP', 'AED']} value={d.baseCurrency} disabled={ro} onChange={(e) => set({ baseCurrency: e.target.value })} /></Field>
          <Field label="Time zone"><Input value={d.timezone} disabled={ro} onChange={(e) => set({ timezone: e.target.value })} /></Field>
          <Field label="Data retention (years)"><Input type="number" min={1} max={50} value={d.settings.dataRetentionYears} disabled={ro} onChange={(e) => ss({ dataRetentionYears: Number(e.target.value) })} /></Field>
          {q.data.org.isDemo && <div className="sm:col-span-2"><Badge tone="warning">Demo organisation: sample data only</Badge></div>}
        </div>
      </Card>
      <Card title="Cost & procurement controls">
        <div className="space-y-3">
          <Checkbox label="Treat tax as cost (non-recoverable tax is posted to the cost ledger)" checked={d.settings.taxIsCost} disabled={ro} onChange={(e) => ss({ taxIsCost: e.target.checked })} />
          <Checkbox label="Approved variations create a budget revision automatically" checked={d.settings.autoBudgetRevisionFromVariation} disabled={ro} onChange={(e) => ss({ autoBudgetRevisionFromVariation: e.target.checked })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Budget check on PR/PO" help="WARN shows a warning; BLOCK prevents submission over budget"><Select options={['WARN', 'BLOCK']} value={d.settings.budgetCheckMode} disabled={ro} onChange={(e) => ss({ budgetCheckMode: e.target.value })} /></Field>
            <Field label="Cost alert threshold (%)" help="Warning when incurred + committed reaches this share of budget"><Input inputMode="decimal" value={pct(d.settings.alertWarnPct)} disabled={ro} onChange={(e) => ss({ alertWarnPct: frac(e.target.value) })} /></Field>
            <Field label="Invoice price tolerance (%)"><Input inputMode="decimal" value={pct(d.settings.priceTolerancePct)} disabled={ro} onChange={(e) => ss({ priceTolerancePct: frac(e.target.value) })} /></Field>
            <Field label="Over-receipt tolerance (%)"><Input inputMode="decimal" value={pct(d.settings.overReceiptTolerancePct)} disabled={ro} onChange={(e) => ss({ overReceiptTolerancePct: frac(e.target.value) })} /></Field>
          </div>
        </div>
      </Card>
      <Card title="Site data rules">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Manpower report uniqueness"><Select options={[{ value: 'PROJECT_DATE_SHIFT_CONTRACTOR', label: 'Project + date + shift + contractor' }, { value: 'PROJECT_DATE_SHIFT', label: 'Project + date + shift' }]} value={d.settings.manpowerUniqueness} disabled={ro} onChange={(e) => ss({ manpowerUniqueness: e.target.value })} /></Field>
          <Field label="Duplicate measurements"><Select options={[{ value: 'BLOCK_UNLESS_REASON', label: 'Block unless a reason is given' }, { value: 'WARN', label: 'Warn only' }]} value={d.settings.measurementDuplicateMode} disabled={ro} onChange={(e) => ss({ measurementDuplicateMode: e.target.value })} /></Field>
        </div>
      </Card>
      {!ro && (
        <div className="flex items-start justify-end lg:col-span-2">
          <Button icon={<Save className="h-4 w-4" />} disabled={!draft} loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>
        </div>
      )}
    </div>
  );
}

function ModuleSettings() {
  const { can, refresh } = useAuth();
  const qc = useQueryClient();
  const q = useSettings();
  const [vis, setVis] = useState<string[] | null>(null);
  const save = useMutation({ mutationFn: () => api.put('/admin/settings', { settings: { visibleModules: vis } }), onSuccess: () => { toast.success('Modules updated'); setVis(null); void qc.invalidateQueries({ queryKey: ['admin', 'settings'] }); void refresh(); }, onError: err });
  if (q.isLoading || !q.data) return <LoadingBlock rows={6} />;
  const cur = vis ?? q.data.settings.visibleModules;
  const ro = !can('settings.manage');
  const always = new Set(['dashboard', 'settings', 'users']);
  return (
    <Card title="Visible modules" subtitle="Hidden modules disappear from navigation for everyone. Permissions still apply to visible modules; hiding a module does not delete data." actions={!ro && <Button size="sm" icon={<Save className="h-4 w-4" />} disabled={!vis} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {MODULE_GROUPS.map((g) => (
          <fieldset key={g}>
            <legend className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{g}</legend>
            {MODULES.filter((m) => m.group === g).map((m) => (
              <Checkbox key={m.key} label={m.label} checked={always.has(m.key) || cur.includes(m.key)} disabled={ro || always.has(m.key)} onChange={() => setVis(cur.includes(m.key) ? cur.filter((x) => x !== m.key) : [...cur, m.key])} />
            ))}
          </fieldset>
        ))}
      </div>
    </Card>
  );
}

function DocTypeSettings() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'doctypes'], queryFn: () => api.get<DocType[]>('/admin/document-types') });
  const [edit, setEdit] = useState<DocType | null>(null);
  const save = useMutation({ mutationFn: () => api.put(`/admin/document-types/${edit!.id}`, { name: edit!.name, abbreviation: edit!.abbreviation, numberFormat: edit!.numberFormat, resetPolicy: edit!.resetPolicy, requiredAttachments: edit!.requiredAttachments, isActive: edit!.isActive }), onSuccess: () => { toast.success('Document type saved'); setEdit(null); void qc.invalidateQueries({ queryKey: ['admin', 'doctypes'] }); }, onError: err });
  return (
    <Card bodyClassName="p-0" title="Document types & numbering" subtitle="Numbers are generated by the database inside the same transaction as the record, so they are unique even with simultaneous users. Tokens: {PROJECT} {ABBR} {YYYY} {YY} {MM} {SEQ:n}.">
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        error={q.error}
        rowKey={(r) => r.id}
        dense
        onRowClick={can('settings.manage') ? (r) => setEdit({ ...r }) : undefined}
        columns={[
          { key: 'c', header: 'Code', cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
          { key: 'n', header: 'Name', cell: (r) => r.name },
          { key: 'f', header: 'Format', cell: (r) => <span className="font-mono text-xs">{r.numberFormat}</span> },
          { key: 'r', header: 'Reset', cell: (r) => humanize(r.resetPolicy), hideOnMobile: true },
          { key: 'w', header: 'Workflow', cell: (r) => (r.workflow ? <Badge tone="info">{r.financial ? 'Approval + limits' : 'Approval'}</Badge> : '—'), hideOnMobile: true },
          { key: 'a', header: 'Min. attachments', align: 'right', cell: (r) => r.requiredAttachments, hideOnMobile: true },
          { key: 's', header: 'Active', cell: (r) => (r.isActive ? 'Yes' : 'No') },
        ]}
      />
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={`Edit ${edit?.code ?? ''}`} description="Changing the format affects new numbers only; existing numbers never change." footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Abbreviation"><Input value={edit.abbreviation} onChange={(e) => setEdit({ ...edit, abbreviation: e.target.value.toUpperCase() })} /></Field>
            <Field label="Number format" className="sm:col-span-2"><Input className="font-mono" value={edit.numberFormat} onChange={(e) => setEdit({ ...edit, numberFormat: e.target.value })} /></Field>
            <Field label="Sequence reset"><Select options={['NEVER', 'YEARLY', 'MONTHLY']} value={edit.resetPolicy} onChange={(e) => setEdit({ ...edit, resetPolicy: e.target.value })} /></Field>
            <Field label="Required attachments on submit"><Input type="number" min={0} max={10} value={edit.requiredAttachments} onChange={(e) => setEdit({ ...edit, requiredAttachments: Number(e.target.value) })} /></Field>
            <Checkbox label="Active" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
          </div>
        )}
      </Dialog>
    </Card>
  );
}

const blankStep = (n: number): WfStep => ({ stepNo: n, name: '', approverRoleCode: null, approverUserId: null, minAmount: null, maxAmount: null, requiredApprovals: 1, slaHours: 48, escalateToRoleCode: null });

function WorkflowSettings() {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'workflows'], queryFn: () => api.get<Workflow[]>('/admin/workflows') });
  const roles = useRoles();
  const [edit, setEdit] = useState<Omit<Workflow, 'id'> | null>(null);
  const save = useMutation({
    mutationFn: () => api.put('/admin/workflows', { ...edit, steps: edit!.steps.map((s, i) => ({ ...s, stepNo: i + 1, minAmount: s.minAmount || null, maxAmount: s.maxAmount || null })) }),
    onSuccess: () => { toast.success('Workflow saved. Pending approvals keep the steps resolved when they were submitted.'); setEdit(null); void qc.invalidateQueries({ queryKey: ['admin', 'workflows'] }); },
    onError: err,
  });
  const wfTypes = useMemo(() => DEFAULT_DOC_TYPES.filter((d) => d.workflow), []);
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error) return <ErrorState error={q.error} />;
  const ro = !can('settings.manage');
  const roleOpts = (roles.data?.roles ?? []).map((r) => ({ value: r.code, label: r.name }));
  const projName = (id: string | null) => (id ? (me?.projects.find((p) => p.id === id)?.code ?? 'Project') : 'All projects');
  const setStep = (i: number, p: Partial<WfStep>) => setEdit((e) => (e ? { ...e, steps: e.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) } : e));
  return (
    <>
      <Card bodyClassName="p-0" title="Approval workflows" subtitle="Steps apply in order; steps with amount ranges apply only when the document amount falls inside the range. Approvers cannot approve their own submissions unless self-approval is allowed. The final approver's approval limit is checked." actions={!ro && <Select aria-label="Add workflow" className="w-64" options={wfTypes.map((d) => ({ value: d.code, label: d.name }))} placeholder="+ Workflow for document type…" value="" onChange={(e) => { const d = wfTypes.find((x) => x.code === e.target.value); if (d) setEdit({ docType: d.code, projectId: null, name: `${d.name} approval`, isActive: true, allowSelfApproval: false, steps: [blankStep(1)] }); }} />}>
        <DataTable
          rows={q.data}
          rowKey={(w) => w.id}
          dense
          onRowClick={ro ? undefined : (w) => setEdit({ docType: w.docType, projectId: w.projectId, name: w.name, isActive: w.isActive, allowSelfApproval: w.allowSelfApproval, steps: w.steps.map((s) => ({ ...s })) })}
          empty={{ title: 'No workflows configured', description: 'Documents without a workflow cannot be submitted for approval.' }}
          columns={[
            { key: 'd', header: 'Document', cell: (w) => <span><span className="block font-medium">{DEFAULT_DOC_TYPES.find((d) => d.code === w.docType)?.name ?? w.docType}</span><span className="text-xs text-muted">{w.name}</span></span> },
            { key: 'p', header: 'Scope', cell: (w) => projName(w.projectId) },
            { key: 's', header: 'Steps', cell: (w) => <span className="text-xs">{w.steps.map((s) => `${s.stepNo}. ${s.name}${s.minAmount || s.maxAmount ? ` (${s.minAmount ? formatMoney(s.minAmount) : '0'}–${s.maxAmount ? formatMoney(s.maxAmount) : '∞'})` : ''}`).join(' → ')}</span> },
            { key: 'a', header: 'Self-approval', cell: (w) => (w.allowSelfApproval ? <Badge tone="warning">Allowed</Badge> : 'No'), hideOnMobile: true },
            { key: 'x', header: 'Active', cell: (w) => (w.isActive ? 'Yes' : 'No') },
          ]}
        />
      </Card>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} size="xl" title={edit ? `Workflow: ${DEFAULT_DOC_TYPES.find((d) => d.code === edit.docType)?.name ?? edit.docType}` : ''} footer={<Button loading={save.isPending} disabled={!edit?.steps.length || edit.steps.some((s) => !s.name || !s.approverRoleCode)} onClick={() => save.mutate()}>Save workflow</Button>}>
        {edit && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Scope" help="A project-specific workflow overrides the organisation default"><Select options={[{ value: '', label: 'All projects' }, ...(me?.projects ?? []).map((p) => ({ value: p.id, label: `${p.code} only` }))]} value={edit.projectId ?? ''} onChange={(e) => setEdit({ ...edit, projectId: e.target.value || null })} /></Field>
              <div className="flex flex-col justify-end gap-1">
                <Checkbox label="Active" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
                <Checkbox label="Allow self-approval (not recommended)" checked={edit.allowSelfApproval} onChange={(e) => setEdit({ ...edit, allowSelfApproval: e.target.checked })} />
              </div>
            </div>
            {edit.steps.map((s, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-6">
                <Field label={`Step ${i + 1} name`} className="sm:col-span-2"><Input value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} /></Field>
                <Field label="Approver role" className="sm:col-span-2"><Select options={roleOpts} placeholder="Choose role" value={s.approverRoleCode ?? ''} onChange={(e) => setStep(i, { approverRoleCode: e.target.value || null })} /></Field>
                <Field label="Approvals needed"><Input type="number" min={1} max={10} value={s.requiredApprovals} onChange={(e) => setStep(i, { requiredApprovals: Number(e.target.value) })} /></Field>
                <Field label="SLA (hours)"><Input type="number" min={1} value={s.slaHours} onChange={(e) => setStep(i, { slaHours: Number(e.target.value) })} /></Field>
                <Field label="Min amount" className="sm:col-span-2"><Input inputMode="decimal" placeholder="none" value={s.minAmount ?? ''} onChange={(e) => setStep(i, { minAmount: e.target.value || null })} /></Field>
                <Field label="Max amount" className="sm:col-span-2"><Input inputMode="decimal" placeholder="none" value={s.maxAmount ?? ''} onChange={(e) => setStep(i, { maxAmount: e.target.value || null })} /></Field>
                <Field label="Escalate to"><Select options={roleOpts} placeholder="—" value={s.escalateToRoleCode ?? ''} onChange={(e) => setStep(i, { escalateToRoleCode: e.target.value || null })} /></Field>
                <div className="flex items-end justify-end"><Button size="sm" variant="ghost" className="text-red-600" disabled={edit.steps.length === 1} onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, j) => j !== i) })} icon={<Trash2 className="h-4 w-4" />} aria-label="Remove step" /></div>
              </div>
            ))}
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ ...edit, steps: [...edit.steps, blankStep(edit.steps.length + 1)] })}>Add step</Button>
            <Textarea readOnly rows={2} className="text-xs" value="Changes apply to documents submitted after saving. Documents already in approval keep their original steps." aria-label="Note" />
          </div>
        )}
      </Dialog>
    </>
  );
}

