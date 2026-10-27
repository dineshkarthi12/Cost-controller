import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Download, Pencil, Plus, Search, Send, Trash2 } from 'lucide-react';
import { RESOURCES, humanize, type FieldDef, type ResourceDef } from '@toprock/shared';
import { api, type Paged } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDate, formatMoney, formatQty } from '../../lib/format';
import { Badge, Button, Card, ConfirmDialog, DescriptionList, ErrorState, Input, LoadingBlock, PermissionDenied, Select, StatusBadge, TabPanel, Tabs, cx } from '../../components/ui';
import { DataTable, downloadCsv, FilterBar, type Column } from '../../components/data/DataTable';
import { RefSelect } from '../../components/forms/RefSelect';
import { ResourceForm } from '../../components/forms/ResourceForm';
import { ApprovalTimeline, AttachmentsPanel, AuditTimeline, CommentsPanel, LinkedEvidence } from '../../components/record/Panels';
import { Page, PageHeader } from '../../components/layout/AppShell';
import { EXTENSIONS } from './extensions';

export type Rec = Record<string, unknown> & { id: string; _labels?: Record<string, string | null>; _permissions?: { canEdit: boolean; canSubmit: boolean; canDelete: boolean; canCancel: boolean } };

export function resourcePath(def: ResourceDef, projectId: string, id?: string) {
  const base = def.projectScoped ? `/projects/${projectId}/r/${def.key}` : `/org/r/${def.key}`;
  return id ? `${base}/${id}` : base;
}

export function renderValue(f: FieldDef, rec: Rec, currency = 'INR'): ReactNode {
  const v = rec[f.name];
  if (v === null || v === undefined || v === '') return <span className="text-slate-400">—</span>;
  switch (f.type) {
    case 'money':
      return <span className="tabular-nums">{formatMoney(String(v), currency)}</span>;
    case 'decimal':
      return <span className="tabular-nums">{formatQty(String(v), 3)}</span>;
    case 'percent':
      return <span className="tabular-nums">{(Number(v) * 100).toFixed(2)}%</span>;
    case 'int':
      return <span className="tabular-nums">{String(v)}</span>;
    case 'date':
    case 'datetime':
      return formatDate(String(v));
    case 'boolean':
      return v ? 'Yes' : 'No';
    case 'ref':
      return rec._labels?.[f.name] ?? <span className="text-slate-400">{String(v).slice(0, 8)}…</span>;
    case 'tags':
      return (
        <span className="flex flex-wrap gap-1">
          {(v as string[]).map((t) => (
            <Badge key={t}>{humanize(t)}</Badge>
          ))}
        </span>
      );
    case 'select':
    case 'text':
      if (f.name === 'status' || f.name === 'result' || f.name === 'priority' || f.name === 'severity') return <StatusBadge status={String(v)} />;
      return f.type === 'select' ? humanize(String(v)) : String(v);
    default:
      return String(v);
  }
}

function useListState(def: ResourceDef) {
  const [params, setParams] = useSearchParams();
  const state = {
    page: Number(params.get('page') ?? 1),
    sort: params.get('sort') ?? def.defaultSort?.field ?? 'createdAt',
    dir: (params.get('dir') as 'asc' | 'desc') ?? def.defaultSort?.dir ?? 'desc',
    q: params.get('q') ?? '',
    filters: Object.fromEntries(def.fields.filter((f) => f.filter || f.name === 'status').map((f) => [f.name, params.get(f.name) ?? ''])),
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  return { state, update };
}

export function ResourceList({ resourceKey, basePath, title, subtitle, actions, fixedFilters, hideHeader, createLabel, statusOptions }: { resourceKey: string; basePath: string; title?: string; subtitle?: ReactNode; actions?: ReactNode; fixedFilters?: Record<string, string>; hideHeader?: boolean; createLabel?: string; statusOptions?: readonly string[] }) {
  const def = RESOURCES[resourceKey];
  const projectId = useProjectId();
  const { can, project } = useAuth();
  const navigate = useNavigate();
  const { state, update } = useListState(def);
  const [search, setSearch] = useState(state.q);
  const params = { page: state.page, pageSize: 25, sort: state.sort, dir: state.dir, q: state.q, from: state.from, to: state.to, ...Object.fromEntries(Object.entries(state.filters).filter(([, v]) => v)), ...fixedFilters };
  const q = useQuery({ queryKey: ['p', 'list', resourceKey, projectId, params], queryFn: () => api.get<Paged<Rec>>(resourcePath(def, projectId), params), enabled: !def.projectScoped || !!projectId, placeholderData: (prev) => prev });
  const listFields = def.fields.filter((f) => f.list);
  const columns: Column<Rec>[] = listFields.map((f, i) => ({
    key: f.name,
    header: f.label,
    sortable: !!(f.sortable || f.list) && f.type !== 'ref' && f.type !== 'tags',
    align: ['money', 'decimal', 'int', 'percent'].includes(f.type) ? 'right' : 'left',
    hideOnMobile: i > 3,
    cell: (r) => (i === 0 ? <span className="font-medium text-navy-800">{renderValue(f, r, project?.currency)}</span> : renderValue(f, r, project?.currency)),
  }));
  const filterFields = def.fields.filter((f) => (f.filter || f.name === 'status') && !(fixedFilters && f.name in fixedFilters));
  const dateField = def.fields.find((f) => f.name === def.defaultSort?.field && f.type === 'date') ?? def.fields.find((f) => f.type === 'date' && f.list);
  const canCreate = can(`${def.area}.manage`);
  if (!can(`${def.area}.view`)) return <PermissionDenied />;
  const titleField = listFields[0];

  return (
    <>
      {!hideHeader && (
        <PageHeader
          title={title ?? def.plural}
          subtitle={subtitle ?? def.description}
          actions={
            <>
              {actions}
              <Button variant="outline" icon={<Download className="h-4 w-4" />} disabled={!q.data?.items.length} onClick={() => downloadCsv(`${def.key}.csv`, listFields.map((f) => ({ key: f.name, label: f.label })), (q.data?.items ?? []).map((r) => Object.fromEntries(listFields.map((f) => [f.name, f.type === 'ref' ? (r._labels?.[f.name] ?? '') : (r[f.name] as string)]))))}>
                CSV
              </Button>
              {canCreate && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate(`${basePath}/new`)}>
                  {createLabel ?? `New ${def.label.toLowerCase()}`}
                </Button>
              )}
            </>
          }
        />
      )}
      <Card bodyClassName="p-0">
        <FilterBar>
          <form
            className="relative min-w-[200px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: search });
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => search !== state.q && update({ q: search })} placeholder={`Search ${def.plural.toLowerCase()}…`} className="pl-9" aria-label="Search" />
          </form>
          {filterFields.map((f) =>
            f.type === 'ref' ? (
              <div key={f.name} className="w-48">
                <RefSelect source={f.ref!} value={state.filters[f.name] || null} placeholder={`All ${f.label.toLowerCase()}`} label={f.label} onChange={(v) => update({ [f.name]: v ?? '' })} />
              </div>
            ) : f.type === 'boolean' ? (
              <Select key={f.name} className="w-40" aria-label={f.label} options={[{ value: 'true', label: `${f.label}: yes` }, { value: 'false', label: `${f.label}: no` }]} placeholder={`${f.label}: any`} value={state.filters[f.name]} onChange={(e) => update({ [f.name]: e.target.value })} />
            ) : (
              <Select key={f.name} className="w-44" aria-label={f.label} options={(f.name === 'status' ? (statusOptions ?? def.statusOptions ?? def.manualStatuses ?? (def.workflow ? ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED'] : f.options ?? [])) : (f.options ?? [])) as string[]} placeholder={`All ${f.label.toLowerCase()}`} value={state.filters[f.name]} onChange={(e) => update({ [f.name]: e.target.value })} />
            ),
          )}
          {dateField && (
            <div className="flex items-center gap-1">
              <Input type="date" className="w-36" aria-label="From date" value={state.from} onChange={(e) => update({ from: e.target.value })} />
              <span className="text-xs text-muted">to</span>
              <Input type="date" className="w-36" aria-label="To date" value={state.to} onChange={(e) => update({ to: e.target.value })} />
            </div>
          )}
        </FilterBar>
        <DataTable
          caption={def.plural}
          columns={columns}
          rows={q.data?.items}
          rowKey={(r) => r.id}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          onRowClick={(r) => navigate(`${basePath}/${r.id}`)}
          sort={{ field: state.sort, dir: state.dir }}
          onSort={(field) => update({ sort: field, dir: state.sort === field && state.dir === 'asc' ? 'desc' : 'asc' })}
          pagination={q.data ? { page: q.data.page, pageSize: q.data.pageSize, total: q.data.total, onPage: (p) => update({ page: p }) } : undefined}
          empty={{ title: `No ${def.plural.toLowerCase()} found`, description: state.q || Object.values(state.filters).some(Boolean) ? 'Try clearing the filters.' : canCreate ? `Create the first ${def.label.toLowerCase()} for this project.` : undefined, action: canCreate ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => navigate(`${basePath}/new`)}>New {def.label.toLowerCase()}</Button> : undefined }}
          mobileCard={(r) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-navy-800">{renderValue(titleField, r, project?.currency)}</p>
                <p className="mt-0.5 truncate text-xs text-muted">{listFields.slice(1, 3).map((f) => (f.type === 'ref' ? r._labels?.[f.name] : f.type === 'date' ? formatDate(String(r[f.name] ?? '')) : r[f.name] ? humanize(String(r[f.name])) : null)).filter(Boolean).join(' · ')}</p>
              </div>
              <div className="shrink-0 text-right text-sm">{'status' in r ? <StatusBadge status={String(r.status)} /> : null}</div>
            </div>
          )}
        />
      </Card>
    </>
  );
}

export interface ExtensionContext {
  def: ResourceDef;
  record: Rec;
  projectId: string;
  basePath: string;
  refetch: () => void;
  can: (p: string) => boolean;
}

export function ResourceDetail({ resourceKey, basePath, breadcrumbs }: { resourceKey: string; basePath: string; breadcrumbs?: Array<{ label: string; to?: string }> }) {
  const def = RESOURCES[resourceKey];
  const { id = '' } = useParams();
  const projectId = useProjectId();
  const { can, project } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState('details');
  const [confirm, setConfirm] = useState<null | 'submit' | 'cancel' | 'delete'>(null);
  const q = useQuery({ queryKey: ['p', 'rec', resourceKey, id], queryFn: () => api.get<Rec>(resourcePath(def, projectId, id)), enabled: !def.projectScoped || !!projectId });
  const refetch = () => {
    void qc.invalidateQueries({ queryKey: ['p'] });
  };
  const action = useMutation({
    mutationFn: ({ kind, reason }: { kind: 'submit' | 'cancel' | 'delete'; reason?: string }) =>
      kind === 'submit' ? api.post(`${resourcePath(def, projectId, id)}/submit`, { comment: reason }) : kind === 'cancel' ? api.post(`${resourcePath(def, projectId, id)}/cancel`, { reason }) : api.del(resourcePath(def, projectId, id)),
    onSuccess: (_d, v) => {
      toast.success(v.kind === 'submit' ? 'Submitted for approval' : v.kind === 'cancel' ? 'Cancelled' : 'Deleted');
      setConfirm(null);
      if (v.kind === 'delete') navigate(basePath);
      else refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const ext = EXTENSIONS[resourceKey];
  if (q.isLoading) return <Page><LoadingBlock rows={8} /></Page>;
  if (q.error || !q.data) return <Page><ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const rec = q.data;
  const perms = rec._permissions ?? { canEdit: false, canSubmit: false, canDelete: false, canCancel: false };
  const ctx: ExtensionContext = { def, record: rec, projectId, basePath, refetch, can };
  const title = String(rec.number ?? rec[def.titleField] ?? def.label);
  const subtitleField = def.fields.find((f) => f.name === def.titleField && f.name !== 'number');
  const docType = def.model === 'measurement' ? String(rec.type) : def.docType;
  const fields = def.fields.filter((f) => f.type !== 'lines' && !f.hideInForm);
  const sections = fields.reduce<Record<string, FieldDef[]>>((acc, f) => {
    (acc[f.section ?? 'Details'] ??= []).push(f);
    return acc;
  }, {});
  const lineDefs = def.fields.filter((f) => f.type === 'lines');
  const tabs = [
    { value: 'details', label: 'Details' },
    ...lineDefs.map((l) => ({ value: `lines:${l.name}`, label: l.label, count: (rec[l.name] as unknown[] | undefined)?.length })),
    ...(ext?.panels?.(ctx) ?? []).map((p) => ({ value: p.value, label: p.label })),
    ...(def.workflow ? [{ value: 'approvals', label: 'Approvals' }] : []),
    ...(def.projectScoped ? [{ value: 'comments', label: 'Comments' }, { value: 'attachments', label: 'Attachments' }] : []),
    ...(['measurement', 'manpowerReport', 'siteDiary', 'grn', 'inspection', 'ncr', 'safetyIncident', 'equipmentLog', 'task', 'expense'].includes(def.model) ? [{ value: 'evidence', label: 'Photo evidence' }] : []),
    { value: 'history', label: 'History' },
  ];

  return (
    <Page>
      <PageHeader
        breadcrumbs={breadcrumbs ?? [{ label: def.plural, to: basePath }, { label: title }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {title}
            {'status' in rec && <StatusBadge status={String(rec.status)} />}
          </span>
        }
        subtitle={subtitleField ? String(rec[subtitleField.name] ?? '') : undefined}
        actions={
          <>
            {ext?.actions?.(ctx)}
            {perms.canEdit && (
              <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => navigate(`${basePath}/${id}/edit`)}>
                Edit
              </Button>
            )}
            {perms.canSubmit && def.model !== 'measurement' && (
              <Button icon={<Send className="h-4 w-4" />} onClick={() => setConfirm('submit')}>
                Submit for approval
              </Button>
            )}
            {perms.canCancel && (
              <Button variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setConfirm('cancel')}>
                Cancel
              </Button>
            )}
            {perms.canDelete && (
              <Button variant="ghost" className="text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirm('delete')}>
                Delete
              </Button>
            )}
          </>
        }
      />
      {ext?.banner?.(ctx)}
      <Card bodyClassName="p-0">
        <Tabs value={tab} onValueChange={setTab} tabs={tabs} className="px-4 pt-1">
          <TabPanel value="details" className="space-y-6 py-5">
            {Object.entries(sections).map(([name, fs]) => (
              <section key={name}>
                {Object.keys(sections).length > 1 && <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{name}</h3>}
                <DescriptionList items={fs.filter((f) => f.type !== 'boolean' || rec[f.name] !== undefined).map((f) => ({ label: f.label, value: renderValue(f, rec, project?.currency), span: f.type === 'textarea' ? 3 : undefined }))} />
              </section>
            ))}
            <p className="text-xs text-muted">
              Created {formatDate(String(rec.createdAt ?? ''))} · Last updated {formatDate(String(rec.updatedAt ?? rec.createdAt ?? ''))}
            </p>
          </TabPanel>
          {lineDefs.map((l) => (
            <TabPanel key={l.name} value={`lines:${l.name}`} className="py-4">
              <LinesTable field={l} rows={(rec[l.name] as Rec[]) ?? []} currency={project?.currency} />
            </TabPanel>
          ))}
          {(ext?.panels?.(ctx) ?? []).map((p) => (
            <TabPanel key={p.value} value={p.value} className="py-4">
              {p.render()}
            </TabPanel>
          ))}
          {def.workflow && docType && (
            <TabPanel value="approvals" className="py-4">
              <ApprovalTimeline docType={docType} entityId={id} onChanged={refetch} />
            </TabPanel>
          )}
          <TabPanel value="comments" className="py-4">
            <CommentsPanel entityType={def.model} entityId={id} />
          </TabPanel>
          <TabPanel value="attachments" className="py-4">
            <AttachmentsPanel entityType={def.model} entityId={id} canUpload={can(`${def.area}.manage`)} />
          </TabPanel>
          <TabPanel value="evidence" className="py-4">
            <LinkedEvidence linkedType={def.model} linkedId={id} />
          </TabPanel>
          <TabPanel value="history" className="py-4">
            <AuditTimeline entityType={def.model} entityId={id} />
          </TabPanel>
        </Tabs>
      </Card>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'submit' ? 'Submit for approval?' : confirm === 'cancel' ? `Cancel this ${def.label.toLowerCase()}?` : `Delete this ${def.label.toLowerCase()}?`}
        message={confirm === 'submit' ? 'The document will be locked and routed to the approvers configured for this document type and amount.' : confirm === 'cancel' ? 'Cancelled documents stay in the register for audit and cannot be reopened.' : 'This permanently removes the draft record.'}
        requireReason={confirm === 'cancel'}
        tone={confirm === 'submit' ? 'primary' : 'danger'}
        confirmLabel={confirm === 'submit' ? 'Submit' : confirm === 'cancel' ? 'Cancel document' : 'Delete'}
        loading={action.isPending}
        onConfirm={(reason) => confirm && action.mutate({ kind: confirm, reason })}
      />
    </Page>
  );
}

export function LinesTable({ field, rows, currency }: { field: FieldDef; rows: Rec[]; currency?: string }) {
  const cols = (field.lines ?? []).filter((f) => !f.hideInForm);
  if (!rows.length) return <p className="text-sm text-muted">No lines.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-muted">#</th>
            {cols.map((c) => (
              <th key={c.name} className={cx('whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted', ['money', 'decimal', 'int', 'percent'].includes(c.type) ? 'text-right' : 'text-left')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className="border-t border-line">
              <td className="px-3 py-2 text-muted">{i + 1}</td>
              {cols.map((c) => (
                <td key={c.name} className={cx('px-3 py-2', ['money', 'decimal', 'int', 'percent'].includes(c.type) && 'text-right tabular-nums')}>
                  {renderValue(c, r, currency)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResourceCreate({ resourceKey, basePath, initial: initialProp, title }: { resourceKey: string; basePath: string; initial?: Record<string, unknown>; title?: string }) {
  const def = RESOURCES[resourceKey];
  const projectId = useProjectId();
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const initial = useMemo(() => ({ ...Object.fromEntries([...params.entries()].filter(([k]) => def.fields.some((f) => f.name === k))), ...initialProp }), [params, def, initialProp]);
  if (!can(`${def.area}.manage`)) return <Page><PermissionDenied /></Page>;
  return (
    <Page className="max-w-5xl">
      <PageHeader breadcrumbs={[{ label: def.plural, to: basePath }, { label: 'New' }]} title={title ?? `New ${def.label.toLowerCase()}`} />
      <Card>
        <ResourceForm
          def={def}
          mode="create"
          initial={initial}
          draftKey={`${projectId}:${def.key}:new`}
          onCancel={() => navigate(basePath)}
          onSubmit={async (body) => {
            const rec = await api.post<Rec>(resourcePath(def, projectId), body);
            toast.success(`${def.label} ${String(rec.number ?? '')} saved`);
            void qc.invalidateQueries({ queryKey: ['p'] });
            navigate(`${basePath}/${rec.id}`, { replace: true });
          }}
        />
      </Card>
    </Page>
  );
}

export function ResourceEdit({ resourceKey, basePath }: { resourceKey: string; basePath: string }) {
  const def = RESOURCES[resourceKey];
  const { id = '' } = useParams();
  const projectId = useProjectId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['p', 'rec', resourceKey, id], queryFn: () => api.get<Rec>(resourcePath(def, projectId, id)) });
  if (q.isLoading) return <Page><LoadingBlock rows={8} /></Page>;
  if (q.error || !q.data) return <Page><ErrorState error={q.error} /></Page>;
  if (!q.data._permissions?.canEdit) return <Page><PermissionDenied message="This record cannot be edited in its current status." /></Page>;
  const title = String(q.data.number ?? q.data[def.titleField] ?? def.label);
  return (
    <Page className="max-w-5xl">
      <PageHeader breadcrumbs={[{ label: def.plural, to: basePath }, { label: title, to: `${basePath}/${id}` }, { label: 'Edit' }]} title={`Edit ${title}`} />
      <Card>
        <ResourceForm
          def={def}
          mode="update"
          record={q.data}
          onCancel={() => navigate(`${basePath}/${id}`)}
          onSubmit={async (body) => {
            await api.patch(resourcePath(def, projectId, id), body);
            toast.success('Changes saved');
            void qc.invalidateQueries({ queryKey: ['p'] });
            navigate(`${basePath}/${id}`, { replace: true });
          }}
        />
      </Card>
    </Page>
  );
}

export function ModuleTabsNav({ tabs, active }: { tabs: Array<{ label: string; path: string }>; active: string }) {
  return (
    <nav className="-mt-1 mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="Module sections">
      {tabs.map((t) => (
        <Link key={t.path} to={t.path} className={cx('whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium', active === t.path ? 'border-navy-800 text-navy-800' : 'border-transparent text-muted hover:text-ink')} aria-current={active === t.path ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
