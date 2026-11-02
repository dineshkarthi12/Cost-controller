import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, CheckCircle2, ClipboardList, Clock, Download, Plus, Send, Sparkles, Trash2, Users } from 'lucide-react';
import { WORK_CATEGORIES, WORK_ITEM_STATUSES, type WorkCategory, type WorkItemStatus } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, todayIso } from '../../lib/format';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, KpiCard, LoadingBlock, PermissionDenied, Select, Textarea, cx } from '../../components/ui';
import { PageHeader } from '../../components/layout/AppShell';

/* ------------------------------------------------------------------ types */

interface Item {
  id: string;
  kind: 'DONE' | 'PLAN';
  category: WorkCategory;
  projectId: string | null;
  project: { id: string; code: string; name: string } | null;
  description: string;
  output: string | null;
  status: WorkItemStatus;
  hours: string | null;
  targetDate: string | null;
  carriedFromId: string | null;
}
interface Report {
  id: string;
  date: string;
  status: 'DRAFT' | 'SUBMITTED' | 'REVIEWED';
  summary: string | null;
  totalHours: string;
  submittedAt: string | null;
  reviewComment: string | null;
  reviewedAt: string | null;
  updatedAt: string;
  user: { id: string; name: string; designation: string | null };
  reviewer: { id: string; name: string } | null;
  items: Item[];
  canReview?: boolean;
}
interface Activity {
  key: string;
  label: string;
  category: WorkCategory;
  projectId: string | null;
  projectName: string | null;
  count: number;
  examples: string[];
}
interface MeResponse {
  date: string;
  report: Report | null;
  previous: { id: string; date: string; plan: Item[]; reviewComment: string | null; reviewer: { name: string } | null } | null;
  activity: Activity[];
}
interface Row {
  key: string;
  kind: 'DONE' | 'PLAN';
  category: WorkCategory;
  projectId: string;
  description: string;
  output: string;
  status: WorkItemStatus;
  hours: string;
  targetDate: string;
  carriedFromId: string | null;
}

const CATEGORY_OPTIONS = (Object.entries(WORK_CATEGORIES) as Array<[WorkCategory, string]>).map(([value, label]) => ({ value, label }));
const STATUS_LABEL: Record<WorkItemStatus, string> = { DONE: 'Done', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', NOT_STARTED: 'Not started' };
const REPORT_TONE = { DRAFT: 'neutral', SUBMITTED: 'info', REVIEWED: 'success' } as const;
const REPORT_LABEL = { DRAFT: 'Draft (not sent)', SUBMITTED: 'Submitted', REVIEWED: 'Reviewed' } as const;
let seq = 0;
const key = () => `r${++seq}`;
const blank = (kind: 'DONE' | 'PLAN'): Row => ({ key: key(), kind, category: 'BOQ', projectId: '', description: '', output: '', status: kind === 'DONE' ? 'DONE' : 'NOT_STARTED', hours: '', targetDate: '', carriedFromId: null });
const fromItem = (i: Item): Row => ({ key: key(), kind: i.kind, category: i.category, projectId: i.projectId ?? '', description: i.description, output: i.output ?? '', status: i.status, hours: i.hours ? String(Number(i.hours)) : '', targetDate: i.targetDate?.slice(0, 10) ?? '', carriedFromId: i.carriedFromId });
const nextDay = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

function useProjects() {
  return useQuery({ queryKey: ['projects-for-work'], queryFn: () => api.get<Array<{ id: string; code: string; name: string }>>('/projects'), staleTime: 300_000 });
}

/* ------------------------------------------------------------------ my report */

export function MyWorkReportPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayIso();
  const q = useQuery({ queryKey: ['p', 'work-me', date], queryFn: () => api.get<MeResponse>('/work-reports/me', { date }), enabled: can('workreport.submit') });
  if (!can('workreport.submit')) {
    return can('workreport.review') ? <TeamWorkReportsPage /> : <PermissionDenied message="Daily work reports are for the office QS / estimation team." />;
  }
  return (
    <div>
      <PageHeader
        title="My daily work report"
        subtitle="What you worked on today with hours, and what you plan for the next working day. Submit it by evening; your reviewer sees it straight away."
        actions={
          <Field label="Date" htmlFor="wr-date">
            <Input id="wr-date" type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setParams({ date: e.target.value })} />
          </Field>
        }
      />
      {q.isLoading || !q.data ? <LoadingBlock rows={6} /> : <ReportEditor key={`${date}-${q.data.report?.updatedAt ?? 'new'}`} data={q.data} />}
    </div>
  );
}

function ReportEditor({ data }: { data: MeResponse }) {
  const qc = useQueryClient();
  const projects = useProjects();
  const report = data.report;
  const locked = report?.status === 'REVIEWED';
  const [rows, setRows] = useState<Row[]>(() => {
    if (report) return report.items.map(fromItem);
    // New report: start from yesterday's plan, so planned work is ticked off or carried on.
    const carried = (data.previous?.plan ?? []).map((p) => ({ ...fromItem(p), kind: 'DONE' as const, status: 'IN_PROGRESS' as WorkItemStatus, hours: '', targetDate: '', carriedFromId: p.id }));
    return [...(carried.length ? carried : [blank('DONE')]), blank('PLAN')];
  });
  const [summary, setSummary] = useState(report?.summary ?? '');
  const done = rows.filter((r) => r.kind === 'DONE');
  const plan = rows.filter((r) => r.kind === 'PLAN');
  const hours = done.reduce((a, r) => a + (Number(r.hours) || 0), 0);
  const set = (k: string, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const remove = (k: string) => setRows((all) => all.filter((r) => r.key !== k));
  const projectOptions = [{ value: '', label: 'Office / general' }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))];

  const save = useMutation({
    mutationFn: (submit: boolean) =>
      api.put<Report>('/work-reports/me', {
        date: data.date,
        summary: summary.trim() || null,
        submit,
        expectedUpdatedAt: report?.updatedAt,
        items: rows
          .filter((r) => r.description.trim())
          .map((r) => ({ kind: r.kind, category: r.category, projectId: r.projectId || null, description: r.description.trim(), output: r.output.trim() || null, status: r.status, hours: r.kind === 'DONE' && r.hours ? Number(r.hours) : null, targetDate: r.kind === 'PLAN' && r.targetDate ? r.targetDate : null, carriedFromId: r.carriedFromId })),
      }),
    onSuccess: (_r, submit) => {
      toast.success(submit ? 'Report submitted to your reviewer' : 'Draft saved');
      void qc.invalidateQueries({ queryKey: ['p', 'work-me'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addActivity = (a: Activity) => setRows((all) => [...all.filter((r) => !(r.kind === 'DONE' && !r.description.trim())), { ...blank('DONE'), category: a.category, projectId: a.projectId ?? '', description: a.label, output: `${a.count} record(s) in the app` }, ...[]]);
  const usedActivity = new Set(done.map((r) => r.description));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Status" value={<Badge tone={report ? REPORT_TONE[report.status] : 'neutral'}>{report ? REPORT_LABEL[report.status] : 'Not started'}</Badge>} icon={<ClipboardList className="h-5 w-5" />} sub={report?.submittedAt ? `Sent ${formatDate(report.submittedAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : undefined} />
        <KpiCard label="Hours today" value={`${hours} h`} icon={<Clock className="h-5 w-5" />} tone={hours > 12 ? 'warning' : 'primary'} sub={`${done.length} piece(s) of work`} />
        <KpiCard label="Plan for next day" value={`${plan.filter((r) => r.description.trim()).length} item(s)`} icon={<CalendarDays className="h-5 w-5" />} />
        <KpiCard label="Yesterday's plan" value={data.previous ? `${data.previous.plan.length} item(s)` : '—'} icon={<CheckCircle2 className="h-5 w-5" />} sub={data.previous ? `from ${formatDate(data.previous.date)}` : 'No earlier report'} />
      </div>

      {report?.reviewComment && (
        <Card>
          <p className="text-sm"><strong>{report.reviewer?.name ?? 'Reviewer'}:</strong> {report.reviewComment}</p>
        </Card>
      )}
      {locked && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">This report has been reviewed and is locked.</p>}

      {!locked && !!data.activity.length && (
        <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-500" />Recorded in the app today</span>} subtitle="Add any of these to your report; then add the hours.">
          <ul className="space-y-2">
            {data.activity.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <strong>{a.label}</strong> × {a.count}{a.projectName ? ` · ${a.projectName}` : ''}
                  {a.examples[0] && <span className="block text-xs text-muted">{a.examples[0]}</span>}
                </span>
                <Button size="sm" variant="outline" disabled={usedActivity.has(a.label)} onClick={() => addActivity(a)}>{usedActivity.has(a.label) ? 'Added' : 'Add'}</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Work done today" subtitle={data.previous?.plan.length && !report ? 'Started from yesterday’s plan: mark each as done, in progress or blocked, and add the hours.' : undefined}>
        <div className="space-y-3">
          {done.map((r, i) => (
            <WorkRow key={r.key} row={r} n={i + 1} locked={locked} projectOptions={projectOptions} onChange={(p) => set(r.key, p)} onRemove={() => remove(r.key)} />
          ))}
          {!locked && <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setRows([...rows, blank('DONE')])}>Add work</Button>}
        </div>
      </Card>

      <Card title={`Plan for ${formatDate(nextDay(data.date))}`} subtitle="What you will work on next. It comes back tomorrow so you can tick it off.">
        <div className="space-y-3">
          {plan.map((r, i) => (
            <WorkRow key={r.key} row={r} n={i + 1} locked={locked} projectOptions={projectOptions} onChange={(p) => set(r.key, p)} onRemove={() => remove(r.key)} />
          ))}
          {!locked && <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setRows([...rows, blank('PLAN')])}>Add plan item</Button>}
        </div>
      </Card>

      <Card>
        <Field label="Notes for your reviewer (optional)" htmlFor="wr-summary">
          <Textarea id="wr-summary" rows={2} value={summary} disabled={locked} placeholder="Issues, help needed, waiting for drawings…" onChange={(e) => setSummary(e.target.value)} />
        </Field>
      </Card>

      {!locked && (
        <div className="sticky bottom-16 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line bg-white/95 p-3 shadow-sm md:bottom-2">
          <span className={cx('mr-auto text-sm', hours > 24 ? 'text-red-600' : 'text-muted')}>{hours} h today</span>
          <Button variant="outline" loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>Save draft</Button>
          <Button icon={<Send className="h-4 w-4" />} loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>{report?.status === 'SUBMITTED' ? 'Update & resend' : 'Submit'}</Button>
        </div>
      )}
    </div>
  );
}

function WorkRow({ row, n, locked, projectOptions, onChange, onRemove }: { row: Row; n: number; locked: boolean; projectOptions: Array<{ value: string; label: string }>; onChange: (p: Partial<Row>) => void; onRemove: () => void }) {
  const id = row.key;
  return (
    <div className={cx('rounded-lg border p-3', row.carriedFromId ? 'border-sky-200 bg-sky-50/40' : 'border-line')}>
      <div className="mb-2 flex items-center justify-between text-xs text-muted">
        <span>{n}.{row.carriedFromId && ' From yesterday’s plan'}</span>
        {!locked && <Button size="sm" variant="ghost" className="text-red-600" aria-label={`Remove item ${n}`} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>}
      </div>
      <div className="grid gap-2 sm:grid-cols-6">
        <Field label="Type of work" htmlFor={`${id}-c`} className="sm:col-span-2">
          <Select id={`${id}-c`} options={CATEGORY_OPTIONS} value={row.category} disabled={locked} onChange={(e) => onChange({ category: e.target.value as WorkCategory })} />
        </Field>
        <Field label="Project" htmlFor={`${id}-p`} className="sm:col-span-2">
          <Select id={`${id}-p`} options={projectOptions} value={row.projectId} disabled={locked} onChange={(e) => onChange({ projectId: e.target.value })} />
        </Field>
        {row.kind === 'DONE' ? (
          <>
            <Field label="Status" htmlFor={`${id}-s`}>
              <Select id={`${id}-s`} options={WORK_ITEM_STATUSES.filter((s) => s !== 'NOT_STARTED').map((s) => ({ value: s, label: STATUS_LABEL[s] }))} value={row.status} disabled={locked} onChange={(e) => onChange({ status: e.target.value as WorkItemStatus })} />
            </Field>
            <Field label="Hours" htmlFor={`${id}-h`}>
              <Input id={`${id}-h`} inputMode="decimal" placeholder="2.5" value={row.hours} disabled={locked} onChange={(e) => onChange({ hours: e.target.value.replace(/[^\d.]/g, '') })} />
            </Field>
          </>
        ) : (
          <Field label="Due" htmlFor={`${id}-d`} className="sm:col-span-2">
            <Input id={`${id}-d`} type="date" value={row.targetDate} disabled={locked} onChange={(e) => onChange({ targetDate: e.target.value })} />
          </Field>
        )}
        <Field label={row.kind === 'DONE' ? 'Work' : 'Planned work'} htmlFor={`${id}-w`} className="sm:col-span-4">
          <Input id={`${id}-w`} value={row.description} disabled={locked} placeholder={row.kind === 'DONE' ? 'e.g. Finishing BOQ for Ponram' : 'e.g. Complete aluminium BOM for Hadara'} onChange={(e) => onChange({ description: e.target.value })} />
        </Field>
        <Field label={row.kind === 'DONE' ? 'Output' : 'Target'} htmlFor={`${id}-o`} className="sm:col-span-2">
          <Input id={`${id}-o`} value={row.output} disabled={locked} placeholder={row.kind === 'DONE' ? '120 items / 70 %' : 'Tower A'} onChange={(e) => onChange({ output: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ team */

interface TeamRow {
  user: { id: string; name: string; designation: string | null };
  report: Report | null;
  planned: number;
  doneFromPlan: number;
  planCompletion: number | null;
}

export function TeamWorkReportsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayIso();
  const [open, setOpen] = useState<string | null>(params.get('report'));
  const q = useQuery({ queryKey: ['p', 'work-team', date], queryFn: () => api.get<{ rows: TeamRow[]; canReview: boolean }>('/work-reports/team', { date }) });
  useEffect(() => setOpen(params.get('report')), [params]);
  if (q.error) return <PermissionDenied message={(q.error as Error).message} />;
  const rows = q.data?.rows ?? [];
  const submitted = rows.filter((r) => r.report && r.report.status !== 'DRAFT');
  const hours = submitted.reduce((a, r) => a + Number(r.report!.totalHours), 0);
  return (
    <div>
      <PageHeader
        title="Team work reports"
        subtitle="Who has reported, hours, and how much of yesterday’s plan was done. Open a report to comment or mark it reviewed."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Date" htmlFor="wt-date"><Input id="wt-date" type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setParams({ date: e.target.value })} /></Field>
            <a className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-sm font-medium hover:bg-slate-50" href={api.url('/work-reports/export', { from: date, to: date })} download><Download className="h-4 w-4" /> Excel</a>
          </div>
        }
      />
      {q.isLoading ? (
        <LoadingBlock rows={5} />
      ) : !rows.length ? (
        <Card><EmptyState icon={<Users className="h-6 w-6" />} title="No team members yet" description={can('user.manage') ? 'Give QS / estimators the Estimator or Quantity Surveyor role under Users & Roles.' : 'Nobody in your team writes daily work reports yet.'} /></Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard label="Submitted" value={`${submitted.length} of ${rows.length}`} icon={<ClipboardList className="h-5 w-5" />} tone={submitted.length < rows.length ? 'warning' : 'success'} />
            <KpiCard label="Hours reported" value={`${hours} h`} icon={<Clock className="h-5 w-5" />} />
            <KpiCard label="Waiting for review" value={rows.filter((r) => r.report?.status === 'SUBMITTED').length} icon={<CheckCircle2 className="h-5 w-5" />} />
          </div>
          <Card bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.user.id}>
                  <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent" disabled={!r.report} onClick={() => r.report && setOpen(r.report.id)}>
                    <span>
                      <span className="font-medium">{r.user.name}</span>
                      <span className="block text-xs text-muted">{r.user.designation ?? ''}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-3 text-sm">
                      {r.report ? (
                        <>
                          <span>{Number(r.report.totalHours)} h</span>
                          <span className="text-muted">{r.report.items.filter((i) => i.kind === 'DONE').length} done · {r.report.items.filter((i) => i.kind === 'PLAN').length} planned</span>
                          {r.planCompletion !== null && <span className="text-muted">Yesterday’s plan {Math.round(r.planCompletion * 100)}%</span>}
                          <Badge tone={REPORT_TONE[r.report.status]}>{REPORT_LABEL[r.report.status]}</Badge>
                        </>
                      ) : (
                        <Badge tone="danger">Not submitted</Badge>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      {open && <ReportDialog id={open} onClose={() => { setOpen(null); if (params.get('report')) setParams({ date }); }} />}
    </div>
  );
}

function ReportDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['p', 'work-report', id], queryFn: () => api.get<Report>(`/work-reports/${id}`) });
  const [comment, setComment] = useState('');
  const review = useMutation({
    mutationFn: (markReviewed: boolean) => api.post(`/work-reports/${id}/review`, { comment: comment.trim() || undefined, markReviewed }),
    onSuccess: (_r, mark) => {
      toast.success(mark ? 'Marked reviewed' : 'Comment sent');
      void qc.invalidateQueries({ queryKey: ['p'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const r = q.data;
  const projectName = (i: Item) => i.project?.name ?? 'Office / general';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={r ? `${r.user.name} · ${formatDate(r.date)}` : 'Work report'} description={r ? `${REPORT_LABEL[r.status]} · ${Number(r.totalHours)} h` : undefined}
      footer={r?.canReview && r.status !== 'DRAFT' ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!comment.trim()} loading={review.isPending && review.variables === false} onClick={() => review.mutate(false)}>Send comment</Button>
          {r.status !== 'REVIEWED' && <Button loading={review.isPending && review.variables === true} onClick={() => review.mutate(true)}>Mark reviewed</Button>}
        </div>
      ) : undefined}
    >
      {!r ? (
        <LoadingBlock rows={4} />
      ) : (
        <div className="space-y-4 text-sm">
          {(['DONE', 'PLAN'] as const).map((k) => (
            <div key={k}>
              <h4 className="mb-1 text-xs font-semibold text-muted uppercase">{k === 'DONE' ? 'Work done' : `Plan for ${formatDate(nextDay(r.date.slice(0, 10)))}`}</h4>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {r.items.filter((i) => i.kind === k).map((i) => (
                  <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                    <span>
                      <span className="font-medium">{i.description}</span>
                      <span className="block text-xs text-muted">{WORK_CATEGORIES[i.category]} · {projectName(i)}{i.output ? ` · ${i.output}` : ''}{i.carriedFromId ? ' · from plan' : ''}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs">
                      {k === 'DONE' ? <><Badge tone={i.status === 'DONE' ? 'success' : i.status === 'BLOCKED' ? 'danger' : 'warning'}>{STATUS_LABEL[i.status]}</Badge><span className="font-medium">{i.hours ? `${Number(i.hours)} h` : ''}</span></> : i.targetDate ? `Due ${formatDate(i.targetDate)}` : ''}
                    </span>
                  </li>
                ))}
                {!r.items.some((i) => i.kind === k) && <li className="px-3 py-2 text-muted">Nothing entered.</li>}
              </ul>
            </div>
          ))}
          {r.summary && <p className="rounded-lg bg-slate-50 p-3"><strong>Notes:</strong> {r.summary}</p>}
          {r.reviewComment && <p className="rounded-lg bg-emerald-50 p-3"><strong>{r.reviewer?.name ?? 'Reviewer'}:</strong> {r.reviewComment}</p>}
          {r.canReview && r.status !== 'DRAFT' && (
            <Field label="Comment (optional)" htmlFor="wr-comment"><Textarea id="wr-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Finish the BOM first; BOQ can wait" /></Field>
          )}
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ summary */

interface SummaryUser {
  user: { id: string; name: string; designation: string | null };
  days: number;
  hours: number;
  items: number;
  byCategory: Record<string, number>;
  byProject: Record<string, number>;
}

export function WorkReportSummaryPage() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(todayIso());
  const q = useQuery({ queryKey: ['p', 'work-summary', from, to], queryFn: () => api.get<{ users: SummaryUser[] }>('/work-reports/summary', { from, to }) });
  const top = (m: Record<string, number>, label: (k: string) => string) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, h]) => `${label(k)} ${h} h`).join(' · ');
  const total = useMemo(() => (q.data?.users ?? []).reduce((a, u) => a + u.hours, 0), [q.data]);
  return (
    <div>
      <PageHeader
        title="Work report summary"
        subtitle="Hours by person, type of work and project over a period (submitted reports only)."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Field label="From" htmlFor="ws-from"><Input id="ws-from" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
            <Field label="To" htmlFor="ws-to"><Input id="ws-to" type="date" value={to} min={from} max={todayIso()} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
            <a className="inline-flex h-9 items-center gap-2 rounded-lg bg-navy-800 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-navy-700" href={api.url('/work-reports/export', { from, to })} download><Download className="h-4 w-4" /> Download Excel</a>
          </div>
        }
      />
      {q.isLoading ? <LoadingBlock rows={4} /> : !q.data?.users.length ? (
        <Card><EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No submitted reports in this period" /></Card>
      ) : (
        <Card bodyClassName="p-0" subtitle={`${total} h in total`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-muted uppercase">
                <tr>{['Name', 'Days', 'Hours', 'Avg / day', 'Main work', 'Main projects'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.data.users.map((u) => (
                  <tr key={u.user.id} className="align-top">
                    <td className="px-3 py-2 font-medium">{u.user.name}<div className="text-xs font-normal text-muted">{u.user.designation}</div></td>
                    <td className="px-3 py-2 text-center">{u.days}</td>
                    <td className="px-3 py-2 text-center">{u.hours}</td>
                    <td className="px-3 py-2 text-center">{u.days ? (u.hours / u.days).toFixed(1) : '—'}</td>
                    <td className="px-3 py-2 text-xs">{top(u.byCategory, (k) => WORK_CATEGORIES[k as WorkCategory] ?? k)}</td>
                    <td className="px-3 py-2 text-xs">{top(u.byProject, (k) => k)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
