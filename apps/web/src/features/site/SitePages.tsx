import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarRange, CheckCircle2, ClipboardList, Flag, RotateCcw, Save, Users } from 'lucide-react';
import { WEEKDAYS } from '@toprock/shared';
import { api, type Paged } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDate, formatMoney, formatQty, humanize, todayIso } from '../../lib/format';
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Input, KpiCard, LoadingBlock, PermissionDenied, ProgressBar, Select, StatusBadge, TabPanel, Tabs, Textarea, cx } from '../../components/ui';
import { DataTable } from '../../components/data/DataTable';
import { ChartCard, ChartTooltip, GRID, SERIES, axisProps } from '../../components/data/charts';
import { RefSelect } from '../../components/forms/RefSelect';
import { PageHeader } from '../../components/layout/AppShell';
import type { Rec } from '../resources/ResourceViews';

const DAY = 86_400_000;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const toTime = (v: unknown) => (v ? new Date(String(v).slice(0, 10) + 'T00:00:00Z').getTime() : null);

/* ------------------------------------------------------------------ Attendance */

interface Worker {
  id: string;
  workerCode: string;
  name: string;
  trade: string;
  category: string;
  contractorId: string | null;
  contractor: { name: string } | null;
}
interface AttendanceRecord {
  id: string;
  status: string;
  regularHours: string;
  overtimeHours: string;
  correctionReason: string | null;
}
interface Row {
  workerId: string;
  status: string;
  regularHours: string;
  overtimeHours: string;
}

const STATUS_DEFAULT_HOURS: Record<string, string> = { PRESENT: '8', HALF_DAY: '4', ABSENT: '0', LEAVE: '0' };

export function AttendancePage() {
  const projectId = useProjectId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [date, setDate] = useState(todayIso());
  const [shift, setShift] = useState('DAY');
  const [edits, setEdits] = useState<Record<string, Row>>({});
  const [reasonOpen, setReasonOpen] = useState(false);
  const [mprOpen, setMprOpen] = useState(false);
  const [mpr, setMpr] = useState<{ contractorId: string | null; costCodeId: string | null }>({ contractorId: null, costCodeId: null });
  const q = useQuery({
    queryKey: ['p', 'attendance', projectId, date, shift],
    queryFn: () => api.get<{ date: string; shift: string; rows: Array<{ worker: Worker; record: AttendanceRecord | null }> }>(`/projects/${projectId}/manpower/attendance`, { date, shift }),
  });
  const rows = q.data?.rows ?? [];
  const current = (workerId: string): Row => {
    if (edits[workerId]) return edits[workerId];
    const rec = rows.find((r) => r.worker.id === workerId)?.record;
    return rec ? { workerId, status: rec.status, regularHours: String(Number(rec.regularHours)), overtimeHours: String(Number(rec.overtimeHours)) } : { workerId, status: '', regularHours: '', overtimeHours: '0' };
  };
  const changesExisting = Object.values(edits).some((e) => {
    const rec = rows.find((r) => r.worker.id === e.workerId)?.record;
    return rec && (rec.status !== e.status || Number(rec.regularHours) !== Number(e.regularHours) || Number(rec.overtimeHours) !== Number(e.overtimeHours));
  });
  const save = useMutation({
    mutationFn: (correctionReason?: string) =>
      api.post<{ created: number; corrected: number }>(`/projects/${projectId}/manpower/attendance`, {
        date,
        shift,
        correctionReason,
        records: Object.values(edits)
          .filter((e) => e.status)
          .map((e) => ({ ...e, regularHours: e.regularHours || '0', overtimeHours: e.overtimeHours || '0' })),
      }),
    onSuccess: (r) => {
      toast.success(`Attendance saved: ${r.created} new, ${r.corrected} corrected`);
      setEdits({});
      setReasonOpen(false);
      void qc.invalidateQueries({ queryKey: ['p', 'attendance'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toMpr = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>(`/projects/${projectId}/manpower/attendance/to-mpr`, { date, shift, contractorId: mpr.contractorId, costCodeId: mpr.costCodeId ?? undefined }),
    onSuccess: (r) => {
      toast.success(`Draft manpower report ${r.number} created`);
      setMprOpen(false);
      navigate(`/manpower/${r.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!can('manpower.view')) return <PermissionDenied />;
  const editable = can('manpower.manage');
  const set = (workerId: string, patch: Partial<Row>) => setEdits((e) => ({ ...e, [workerId]: { ...current(workerId), ...patch } }));
  const markAll = (status: string) => setEdits(Object.fromEntries(rows.filter((r) => !r.record).map((r) => [r.worker.id, { workerId: r.worker.id, status, regularHours: STATUS_DEFAULT_HOURS[status], overtimeHours: '0' }])));
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    const s = current(r.worker.id).status || 'UNMARKED';
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  const dirty = Object.values(edits).filter((e) => e.status).length;
  return (
    <>
      <PageHeader
        title="Attendance register"
        subtitle="Daily attendance per worker. Saved entries can only be changed with a correction reason, which is audited. A verified manpower report locks the day."
        actions={
          editable && (
            <>
              <Button variant="outline" icon={<ClipboardList className="h-4 w-4" />} onClick={() => setMprOpen(true)} disabled={!rows.some((r) => r.record)}>
                Create MPR from register
              </Button>
              <Button icon={<Save className="h-4 w-4" />} disabled={!dirty} loading={save.isPending} onClick={() => (changesExisting ? setReasonOpen(true) : save.mutate(undefined))}>
                Save {dirty ? `(${dirty})` : ''}
              </Button>
            </>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KpiCard label="Workers" value={rows.length} icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Present" value={counts.PRESENT ?? 0} tone="success" />
        <KpiCard label="Half day" value={counts.HALF_DAY ?? 0} tone="warning" />
        <KpiCard label="Absent / leave" value={(counts.ABSENT ?? 0) + (counts.LEAVE ?? 0)} tone="neutral" />
        <KpiCard label="Not marked" value={counts.UNMARKED ?? 0} tone={counts.UNMARKED ? 'danger' : 'neutral'} />
      </div>
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-3">
          <Field label="Date">
            <Input type="date" value={date} max={todayIso()} onChange={(e) => { setDate(e.target.value); setEdits({}); }} />
          </Field>
          <Field label="Shift">
            <Select options={['DAY', 'NIGHT', 'GENERAL']} value={shift} onChange={(e) => { setShift(e.target.value); setEdits({}); }} />
          </Field>
          {editable && (
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => markAll('PRESENT')}>Mark unmarked present</Button>
            </div>
          )}
        </div>
        <DataTable
          rows={rows}
          loading={q.isLoading}
          error={q.error}
          rowKey={(r) => r.worker.id}
          dense
          empty={{ title: 'No active workers', description: 'Add workers in the Workers tab first.' }}
          columns={[
            { key: 'w', header: 'Worker', cell: (r) => <span><span className="block font-medium">{r.worker.name}</span><span className="text-xs text-muted">{r.worker.workerCode} · {r.worker.trade} · {humanize(r.worker.category)}</span></span> },
            { key: 'c', header: 'Contractor', cell: (r) => r.worker.contractor?.name ?? <span className="text-muted">Own labour</span>, hideOnMobile: true },
            {
              key: 's',
              header: 'Status',
              cell: (r) => {
                const cur = current(r.worker.id);
                return editable ? (
                  <Select
                    aria-label={`Status for ${r.worker.name}`}
                    className={cx('w-36', edits[r.worker.id] && 'ring-2 ring-brand-300')}
                    options={['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE'].map((s) => ({ value: s, label: humanize(s) }))}
                    placeholder="—"
                    value={cur.status}
                    onChange={(e) => set(r.worker.id, { status: e.target.value, regularHours: STATUS_DEFAULT_HOURS[e.target.value] ?? '0' })}
                  />
                ) : cur.status ? <StatusBadge status={cur.status} /> : '—';
              },
            },
            { key: 'rh', header: 'Reg hrs', align: 'right', cell: (r) => (editable ? <Input aria-label={`Regular hours for ${r.worker.name}`} className="w-20 text-right" inputMode="decimal" value={current(r.worker.id).regularHours} onChange={(e) => set(r.worker.id, { regularHours: e.target.value })} /> : current(r.worker.id).regularHours) },
            { key: 'ot', header: 'OT hrs', align: 'right', cell: (r) => (editable ? <Input aria-label={`Overtime hours for ${r.worker.name}`} className="w-20 text-right" inputMode="decimal" value={current(r.worker.id).overtimeHours} onChange={(e) => set(r.worker.id, { overtimeHours: e.target.value })} /> : current(r.worker.id).overtimeHours) },
            { key: 'n', header: 'Note', cell: (r) => (r.record?.correctionReason ? <span className="text-xs text-amber-700">Corrected: {r.record.correctionReason}</span> : r.record ? <span className="text-xs text-muted">Saved</span> : null), hideOnMobile: true },
          ]}
        />
      </Card>
      <ConfirmDialog open={reasonOpen} onOpenChange={setReasonOpen} title="Correct saved attendance" message="You are changing attendance that was already saved. The original values and your reason are kept in the audit trail." requireReason reasonLabel="Correction reason" confirmLabel="Save corrections" loading={save.isPending} onConfirm={(reason) => save.mutate(reason)} />
      <Dialog open={mprOpen} onOpenChange={setMprOpen} title="Create manpower report from attendance" description="Groups present and half-day workers by trade, category and rate into a draft MPR. Review it before submitting." footer={<Button loading={toMpr.isPending} onClick={() => toMpr.mutate()}>Create draft MPR</Button>}>
        <div className="space-y-3">
          <Field label="Contractor" help="Leave empty for own (chargeable) labour">
            <RefSelect source="subcontractors" value={mpr.contractorId} onChange={(v) => setMpr({ ...mpr, contractorId: v })} placeholder="Own labour" />
          </Field>
          <Field label="Cost code" help="Optional; can also be set per line in the draft">
            <RefSelect source="costCodes" value={mpr.costCodeId} onChange={(v) => setMpr({ ...mpr, costCodeId: v })} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ Progress & schedule */

interface Activity extends Rec {
  code: string;
  name: string;
  unit: string | null;
  plannedQty: string | null;
  executedQty: string | null;
  percentComplete: string | null;
  weight: string | null;
  plannedStart: string | null;
  plannedFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  isMilestone: boolean;
  status: string;
  delayReason: string | null;
}

function useActivities() {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ['p', 'activities-all', projectId],
    queryFn: () => api.get<Paged<Activity>>(`/projects/${projectId}/r/activities`, { pageSize: 200, sort: 'sortOrder', dir: 'asc' }),
  });
}

/** Linear planned % between planned start and finish, as of `asOf`. */
export function plannedPctAt(a: Pick<Activity, 'plannedStart' | 'plannedFinish'>, asOf: number) {
  const s = toTime(a.plannedStart);
  const f = toTime(a.plannedFinish);
  if (s === null || f === null) return null;
  if (asOf <= s) return 0;
  if (asOf >= f) return 100;
  return ((asOf - s) / Math.max(f - s, DAY)) * 100;
}

function weighted(acts: Activity[], fn: (a: Activity) => number | null) {
  let w = 0;
  let v = 0;
  for (const a of acts) {
    const x = fn(a);
    if (x === null) continue;
    const wt = num(a.weight) || 1;
    w += wt;
    v += wt * x;
  }
  return w ? v / w : null;
}

export function ProgressPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const q = useActivities();
  const now = Date.now();
  const acts = q.data?.items ?? [];
  const actual = weighted(acts, (a) => num(a.percentComplete));
  const planned = weighted(acts, (a) => plannedPctAt(a, now));
  const byStatus = acts.reduce<Record<string, number>>((m, a) => ({ ...m, [a.status]: (m[a.status] ?? 0) + 1 }), {});
  const behind = acts.filter((a) => {
    const p = plannedPctAt(a, now);
    return p !== null && a.status !== 'COMPLETED' && p - num(a.percentComplete) >= 10;
  });
  if (!can('progress.view')) return <PermissionDenied />;
  return (
    <>
      <PageHeader title="Progress overview" subtitle="Physical progress is weighted by activity weight. Reported progress never becomes certified quantity; that needs measurement verification." actions={can('progress.manage') && <Button onClick={() => navigate('/progress/entries/new')}>Record progress</Button>} />
      {q.isLoading ? (
        <LoadingBlock rows={6} />
      ) : !acts.length ? (
        <EmptyState title="No activities yet" description="Create schedule activities first; progress is recorded against them." action={<Button onClick={() => navigate('/schedule/activities/new')}>Add activity</Button>} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Actual physical progress" value={actual === null ? '—' : `${actual.toFixed(1)}%`} tone="primary" />
            <KpiCard label="Planned as of today" value={planned === null ? '—' : `${planned.toFixed(1)}%`} tone="neutral" hint="Linear between planned start and finish dates" />
            <KpiCard label="Progress variance" value={actual === null || planned === null ? '—' : `${(actual - planned).toFixed(1)} pts`} tone={actual !== null && planned !== null && actual < planned ? 'danger' : 'success'} />
            <KpiCard label="Activities ≥10 pts behind plan" value={behind.length} tone={behind.length ? 'warning' : 'success'} />
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {Object.entries(byStatus).map(([s, n]) => (
              <Badge key={s} tone="neutral">
                {humanize(s)}: {n}
              </Badge>
            ))}
          </div>
          <Card bodyClassName="p-0" title="Activities: planned vs actual">
            <DataTable
              rows={acts}
              rowKey={(a) => a.id}
              dense
              onRowClick={(a) => navigate(`/schedule/activities/${a.id}`)}
              columns={[
                { key: 'c', header: 'Activity', cell: (a) => <span><span className="block font-medium">{a.code} {a.isMilestone && <Flag className="inline h-3.5 w-3.5 text-brand-600" aria-label="Milestone" />}</span><span className="text-xs text-muted">{a.name}</span></span> },
                { key: 'q', header: 'Executed / planned', align: 'right', cell: (a) => (a.plannedQty ? `${formatQty(a.executedQty ?? '0', 2)} / ${formatQty(a.plannedQty, 2)} ${a.unit ?? ''}` : '—'), hideOnMobile: true },
                {
                  key: 'p',
                  header: 'Progress',
                  cell: (a) => {
                    const p = plannedPctAt(a, now);
                    const act = num(a.percentComplete);
                    return (
                      <div className="w-44">
                        <ProgressBar value={act} tone={p !== null && p - act >= 10 ? 'warning' : 'primary'} label={`${act.toFixed(0)}% actual`} />
                        <p className="mt-0.5 text-[11px] text-muted">{act.toFixed(0)}% actual · {p === null ? 'no plan dates' : `${p.toFixed(0)}% planned`}</p>
                      </div>
                    );
                  },
                },
                { key: 'f', header: 'Planned finish', cell: (a) => formatDate(a.plannedFinish), hideOnMobile: true },
                { key: 's', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
              ]}
            />
          </Card>
        </>
      )}
    </>
  );
}

interface CpmRow {
  id: string;
  code: string;
  status: string;
  earlyStart: string;
  earlyFinish: string;
  totalFloat: number | null;
  critical: boolean;
  finishVarianceDays: number | null;
  baselineStart: string | null;
  baselineFinish: string | null;
  baselineVarianceDays: number | null;
}
interface Cpm {
  asOf: string;
  dependencies: number;
  forecastFinish?: string;
  plannedFinish?: string | null;
  slipDays?: number | null;
  baselineFinish?: string | null;
  slipVsBaselineDays?: number | null;
  calendar?: { workWeek: string; holidays: number; unit: string };
  criticalPath: string[];
  activities: CpmRow[];
}

const CRITICAL = '#e34948';
const slipText = (d: number | null | undefined) => (d === null || d === undefined ? '—' : d > 0 ? `${d} days late` : d < 0 ? `${-d} days early` : 'On time');

export function SchedulePage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const projectId = useProjectId();
  const q = useActivities();
  const cpmQ = useQuery({ queryKey: ['p', 'cpm', projectId], queryFn: () => api.get<Cpm>(`/projects/${projectId}/schedule/cpm`), retry: false });
  const [view, setView] = useState<'all' | 'lookahead' | 'critical'>('all');
  const now = Date.now();
  const cpm = useMemo(() => new Map((cpmQ.data?.activities ?? []).map((r) => [r.id, r])), [cpmQ.data]);
  const acts = useMemo(() => {
    const all = (q.data?.items ?? []).filter((a) => a.plannedStart && a.plannedFinish);
    if (view === 'all') return all;
    if (view === 'critical') return all.filter((a) => cpm.get(a.id)?.critical);
    const horizon = now + 21 * DAY;
    return all.filter((a) => a.status !== 'COMPLETED' && toTime(a.plannedStart)! <= horizon && toTime(a.plannedFinish)! >= now - 7 * DAY);
  }, [q.data, view, now, cpm]);
  if (!can('progress.view')) return <PermissionDenied />;
  const fcStart = (a: Activity) => toTime(cpm.get(a.id)?.earlyStart) ?? toTime(a.actualStart);
  const fcEnd = (a: Activity) => {
    const f = toTime(cpm.get(a.id)?.earlyFinish);
    return f !== null ? f + DAY : (toTime(a.actualFinish) ?? (a.actualStart ? now : null));
  };
  const blStart = (a: Activity) => toTime(cpm.get(a.id)?.baselineStart ?? null);
  const blEnd = (a: Activity) => {
    const f = toTime(cpm.get(a.id)?.baselineFinish ?? null);
    return f === null ? null : f + DAY;
  };
  const starts = acts.flatMap((a) => [toTime(a.plannedStart), fcStart(a), blStart(a)]).filter((x): x is number => x !== null);
  const ends = acts.flatMap((a) => [toTime(a.plannedFinish), fcEnd(a), blEnd(a)]).filter((x): x is number => x !== null);
  const min = view === 'lookahead' ? now - 7 * DAY : Math.min(...starts);
  const max = view === 'lookahead' ? now + 21 * DAY : Math.max(...ends);
  const span = Math.max(max - min, DAY);
  const pos = (t: number) => `${Math.min(100, Math.max(0, ((t - min) / span) * 100))}%`;
  const width = (s: number, f: number) => `${Math.max(0.6, ((Math.min(f, max) - Math.max(s, min)) / span) * 100)}%`;
  const months: Array<{ t: number; label: string; show: boolean }> = [];
  if (acts.length) {
    const d = new Date(min);
    d.setUTCDate(1);
    for (let t = d.getTime(); t <= max; ) {
      const dt = new Date(t);
      if (t >= min) months.push({ t, label: dt.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }), show: true });
      dt.setUTCMonth(dt.getUTCMonth() + 1);
      t = dt.getTime();
    }
  }
  // Thin the month labels so they never overlap (roughly 56px per label on the ~900px timeline).
  const every = Math.max(1, Math.ceil(months.length / 14));
  months.forEach((m, i) => (m.show = i % every === 0));
  const undated = (q.data?.items ?? []).length - (q.data?.items ?? []).filter((a) => a.plannedStart && a.plannedFinish).length;
  const c = cpmQ.data;
  const criticalCount = (c?.activities ?? []).filter((r) => r.critical).length;
  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle="Planned bars come from planned dates. Forecast bars come from the critical path calculation: actual dates, progress, and the dependencies between activities, as of today."
        actions={
          <>
            <Tabs value={view} onValueChange={(v) => setView(v as 'all' | 'lookahead' | 'critical')} tabs={[{ value: 'all', label: 'Full schedule' }, { value: 'critical', label: 'Critical path' }, { value: 'lookahead', label: '3-week look-ahead' }]} />
            {can('progress.manage') && <ImportScheduleButton />}
            {can('progress.manage') && <BaselineButton />}
            <CalendarButton manage={can('progress.manage')} />
            {can('progress.manage') && <FromBoqButton />}
            {can('progress.manage') && <Button variant="outline" onClick={() => navigate('/schedule/activities/new')}>Add activity</Button>}
          </>
        }
      />
      {c?.forecastFinish && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Forecast finish" value={formatDate(c.forecastFinish)} tone={c.slipDays && c.slipDays > 0 ? 'danger' : 'success'} hint="From the critical path calculation" />
          {c.baselineFinish ? (
            <KpiCard label="Baseline finish" value={formatDate(c.baselineFinish)} tone="neutral" sub={`Current plan ${formatDate(c.plannedFinish)}`} hint="The approved plan saved with “Save baseline”" />
          ) : (
            <KpiCard label="Planned finish" value={formatDate(c.plannedFinish)} tone="neutral" sub="No baseline saved yet" />
          )}
          {c.baselineFinish ? (
            <KpiCard label="Forecast vs baseline" value={slipText(c.slipVsBaselineDays)} tone={c.slipVsBaselineDays && c.slipVsBaselineDays > 0 ? 'danger' : 'success'} sub={`vs current plan: ${slipText(c.slipDays)}`} hint="Calendar days between the forecast finish and the baseline finish" />
          ) : (
            <KpiCard label="Forecast vs plan" value={slipText(c.slipDays)} tone={c.slipDays && c.slipDays > 0 ? 'danger' : 'success'} />
          )}
          <KpiCard label="Critical activities" value={criticalCount} tone={criticalCount ? 'warning' : 'neutral'} hint="Zero float: any delay moves the finish date" />
        </div>
      )}
      {cpmQ.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(cpmQ.error as Error).message}</p>}
      {c && c.dependencies === 0 && (q.data?.items.length ?? 0) > 1 && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">No dependencies yet, so the critical path only reflects dates. Open an activity → <strong>Dependencies</strong> tab to link it to its predecessors.</p>
      )}
      {q.isLoading ? (
        <LoadingBlock rows={8} />
      ) : !acts.length ? (
        <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={view === 'lookahead' ? 'Nothing scheduled in the look-ahead window' : view === 'critical' ? 'No critical activities' : 'No dated activities'} description="Activities need planned start and finish dates to appear on the Gantt chart." />
      ) : (
        <Card bodyClassName="p-0">
          <div className="flex flex-wrap items-center gap-4 border-b border-line px-4 py-2 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ background: '#c5d8f2' }} /> Planned</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ background: SERIES[0] }} /> Forecast / actual</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ background: SERIES[1] }} /> Forecast late</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ background: CRITICAL }} /> Critical</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-1 w-5 rounded-sm bg-slate-500" /> Baseline</span>
            <span className="flex items-center gap-1.5"><Flag className="h-3.5 w-3.5 text-brand-600" /> Milestone</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-0.5 bg-red-500" /> Today</span>
            {undated > 0 && <span className="ml-auto">{undated} activity(ies) without planned dates are hidden</span>}
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[260px_1fr] border-b border-line bg-surface-50 text-[11px] text-muted">
                <div className="px-3 py-1.5 font-medium">Activity · float{c?.calendar ? ` (${c.calendar.unit})` : ''}</div>
                <div className="relative h-7">
                  {months.filter((m) => m.show).map((m) => (
                    <span key={m.t} className="absolute top-1.5 border-l border-line pl-1 whitespace-nowrap" style={{ left: pos(m.t) }}>
                      {m.label}
                    </span>
                  ))}
                </div>
              </div>
              {acts.map((a) => {
                const ps = toTime(a.plannedStart)!;
                const pf = toTime(a.plannedFinish)!;
                const r = cpm.get(a.id);
                const fs = fcStart(a);
                const fe = fcEnd(a);
                const late = (r?.finishVarianceDays ?? 0) > 0;
                const color = r?.critical ? CRITICAL : late ? SERIES[1] : SERIES[0];
                const float = r?.totalFloat;
                return (
                  <div key={a.id} className="grid grid-cols-[260px_1fr] border-b border-line last:border-0 hover:bg-surface-50">
                    <Link to={`/schedule/activities/${a.id}`} className="flex min-w-0 items-center gap-1.5 px-3 py-2 text-sm hover:underline">
                      <span className="truncate"><span className="font-medium text-navy-800">{a.code}</span> <span className="text-muted">{a.name}</span></span>
                      {r?.critical ? <Badge tone="danger" className="ml-auto shrink-0">Critical</Badge> : float !== null && float !== undefined ? <span className="ml-auto shrink-0 text-[11px] text-muted">{float} d</span> : null}
                    </Link>
                    <div className="relative h-10" title={`${a.name}: planned ${formatDate(a.plannedStart)} – ${formatDate(a.plannedFinish)}${r?.baselineFinish ? `; baseline ${formatDate(r.baselineStart)} – ${formatDate(r.baselineFinish)}` : ''}${r ? `; forecast ${formatDate(r.earlyStart)} – ${formatDate(r.earlyFinish)}; float ${r.totalFloat ?? '—'} ${c?.calendar?.unit ?? 'days'}` : ''}${r?.baselineVarianceDays ? `; ${slipText(r.baselineVarianceDays)} vs baseline` : ''}; ${num(a.percentComplete).toFixed(0)}% complete`}>
                      {months.map((m) => <span key={m.t} className="absolute inset-y-0 border-l border-dashed" style={{ left: pos(m.t), borderColor: GRID }} />)}
                      {a.isMilestone ? (
                        <Flag className="absolute top-2.5 h-4 w-4 -translate-x-1/2" style={{ left: pos(fs ?? pf), color: r?.critical ? CRITICAL : undefined }} aria-label={`Milestone ${formatDate(r?.earlyFinish ?? a.plannedFinish)}`} />
                      ) : (
                        <span className="absolute top-2 h-2.5 rounded" style={{ left: pos(ps), width: width(ps, pf + DAY), background: '#c5d8f2' }} />
                      )}
                      {!a.isMilestone && fs !== null && fe !== null && <span className="absolute top-5 h-2.5 rounded" style={{ left: pos(fs), width: width(fs, fe), background: color }} />}
                      {!a.isMilestone && blStart(a) !== null && blEnd(a) !== null && <span className="absolute top-8 h-1 rounded bg-slate-500" style={{ left: pos(blStart(a)!), width: width(blStart(a)!, blEnd(a)!) }} />}
                      <span className="absolute inset-y-0 w-0.5 bg-red-500/70" style={{ left: pos(now) }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

interface SchedulePreview {
  id: string;
  summary: { format: string; projectName: string | null; activities: number; newActivities: number; updatedActivities: number; dependencies: number; warnings: string[] };
  activities: Array<{ code: string; name: string; wbs: string | null; plannedStart: string | null; plannedFinish: string | null; actualStart: string | null; actualFinish: string | null; percentComplete: number; isMilestone: boolean; exists: boolean }>;
}

/** MS Project XML / Primavera XER import: upload → preview → import. */
function ImportScheduleButton() {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [withProgress, setWithProgress] = useState(true);
  const reset = () => {
    setFile(null);
    setPreview(null);
    setWithProgress(true);
  };
  const doPreview = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.append('file', file!);
      return api.upload<SchedulePreview>(`/projects/${projectId}/schedule/import/preview`, f);
    },
    onSuccess: setPreview,
    onError: (e: Error) => toast.error(e.message),
  });
  const commit = useMutation({
    mutationFn: () => api.post<{ created: number; updated: number; dependencies: number }>(`/projects/${projectId}/schedule/import/${preview!.id}/commit`, { includeProgress: withProgress }),
    onSuccess: (r) => {
      toast.success(`Schedule imported: ${r.created} new, ${r.updated} updated, ${r.dependencies} dependencies`);
      setOpen(false);
      reset();
      void qc.invalidateQueries({ queryKey: ['p'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const s = preview?.summary;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Import schedule</Button>
      <Dialog
        open={open}
        onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}
        size="xl"
        title="Import schedule"
        description="Excel (.xlsx): one row per activity with a name and Start / Finish (or Start and Duration); Activity ID, Predecessors, WBS, Milestone, Unit, Qty, Weight and % Complete are read when present. Microsoft Project: File → Save As → XML. Primavera P6: File → Export → XER. Activities are matched by code: existing ones are updated, new ones are created."
        footer={
          preview ? (
            <>
              <Button variant="ghost" onClick={reset}>Choose another file</Button>
              <Button loading={commit.isPending} onClick={() => commit.mutate()}>Import {s!.activities} activities</Button>
            </>
          ) : (
            <Button disabled={!file} loading={doPreview.isPending} onClick={() => doPreview.mutate()}>Upload & preview</Button>
          )
        }
      >
        {!preview ? (
          <div className="space-y-3">
            <Field label="Schedule file (.xlsx, .xml or .xer)" required>
              <Input type="file" accept=".xlsx,.xml,.xer,text/xml,application/xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            <p className="text-sm text-muted">
              Planning in Excel?{' '}
              <a className="font-medium text-brand-600 hover:underline" href={api.url(`/projects/${projectId}/schedule/import/template`)} download>
                Download the Excel template
              </a>{' '}
              to see the columns. Dates like 15-01-2027 or 15-Jan-27; predecessors like “A-110” or “A-110 FS+2”; rows with only a name (e.g. TOWER A) are taken as headings.
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{s!.format === 'PRIMAVERA_XER' ? 'Primavera P6' : s!.format === 'EXCEL' ? 'Excel' : 'MS Project'}</Badge>
              {s!.projectName && <strong>{s!.projectName}</strong>}
              <Badge tone="success">{s!.newActivities} new</Badge>
              <Badge tone="neutral">{s!.updatedActivities} update existing</Badge>
              <Badge tone="neutral">{s!.dependencies} dependencies</Badge>
            </div>
            {s!.warnings.map((w) => <p key={w} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{w}</p>)}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={withProgress} onChange={(e) => setWithProgress(e.target.checked)} />
              Also import progress (actual start/finish and % complete)
            </label>
            <div className="max-h-[45vh] overflow-auto rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-50 text-left text-muted">
                  <tr>{['Code', 'Activity', 'Planned', 'Actual', '%', ''].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.activities.map((a) => (
                    <tr key={a.code} className="border-t border-line">
                      <td className="px-2 py-1 font-medium whitespace-nowrap">{a.code}</td>
                      <td className="max-w-[260px] truncate px-2 py-1">
                        {a.isMilestone && <Flag className="mr-1 inline h-3 w-3" />}
                        {a.name}
                        {a.wbs && <span className="block truncate text-[11px] text-muted">{a.wbs}</span>}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{formatDate(a.plannedStart)} – {formatDate(a.plannedFinish)}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{a.actualStart ? `${formatDate(a.actualStart)} – ${a.actualFinish ? formatDate(a.actualFinish) : '…'}` : '—'}</td>
                      <td className="px-2 py-1 text-right">{a.percentComplete}</td>
                      <td className="px-2 py-1">{a.exists ? <Badge tone="neutral">update</Badge> : <Badge tone="success">new</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

interface BoqCandidate {
  id: string;
  itemCode: string;
  description: string;
  section: string | null;
  unit: string;
  qty: string;
  amount: string;
  activities: string[];
}

/** Creates activities from chosen BOQ items (linked, with unit, quantity, cost code and WBS); dates are added afterwards. */
function FromBoqButton() {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [weightBy, setWeightBy] = useState<'AMOUNT' | 'EQUAL'>('AMOUNT');
  const q = useQuery({ queryKey: ['p', 'schedule-from-boq', projectId], queryFn: () => api.get<BoqCandidate[]>(`/projects/${projectId}/schedule/from-boq`), enabled: open });
  const rows = q.data ?? [];
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((r) => words.every((w) => `${r.itemCode} ${r.description} ${r.section ?? ''}`.toLowerCase().includes(w)));
  const groups = useMemo(() => {
    const g = new Map<string, BoqCandidate[]>();
    for (const r of shown) g.set(r.section || 'Other items', [...(g.get(r.section || 'Other items') ?? []), r]);
    return [...g.entries()];
  }, [shown]);
  const free = shown.filter((r) => !r.activities.length);
  const toggle = (ids: string[], on: boolean) => setPicked((p) => { const n = new Set(p); for (const id of ids) (on ? n.add(id) : n.delete(id)); return n; });
  const create = useMutation({
    mutationFn: () => api.post<{ created: number; skipped: string[] }>(`/projects/${projectId}/schedule/from-boq`, { boqItemIds: [...picked], weightBy }),
    onSuccess: (r) => {
      toast.success(`${r.created} activit${r.created === 1 ? 'y' : 'ies'} created from the BOQ. Add their dates on the Activities tab, or import an Excel programme with the same activity IDs.`, { duration: 9000 });
      setOpen(false);
      setPicked(new Set());
      void qc.invalidateQueries({ queryKey: ['p'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Add from BOQ</Button>
      <Dialog
        open={open}
        onOpenChange={(o) => { setOpen(o); if (!o) setPicked(new Set()); }}
        size="xl"
        title="Create activities from BOQ items"
        description="One activity per BOQ item, linked to it with its unit, quantity, cost code and WBS, so progress entered on the activity moves the BOQ executed quantity. The activity ID is the BOQ item code (with B- in front when the code is only numbers, e.g. B-3.01). Add dates and links afterwards."
        footer={
          <>
            <span className="mr-auto self-center text-sm text-muted">{picked.size ? `${picked.size} selected` : 'Nothing selected'}</span>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!picked.size} loading={create.isPending} onClick={() => create.mutate()}>Create {picked.size || ''} activit{picked.size === 1 ? 'y' : 'ies'}</Button>
          </>
        }
      >
        {q.isLoading ? (
          <LoadingBlock rows={6} />
        ) : !rows.length ? (
          <p className="text-sm text-muted">This project has no BOQ items yet. Import the BOQ first (BOQ → Import).</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Input className="min-w-56 flex-1" placeholder="Search BOQ items…" aria-label="Search BOQ items" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select
                className="w-64"
                aria-label="Weight"
                options={[{ value: 'AMOUNT', label: 'Weight by BOQ amount (₹ lakh)' }, { value: 'EQUAL', label: 'Equal weight' }]}
                value={weightBy}
                onChange={(e) => setWeightBy(e.target.value as 'AMOUNT' | 'EQUAL')}
              />
              {free.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => toggle(free.map((r) => r.id), !free.every((r) => picked.has(r.id)))}>
                  {free.every((r) => picked.has(r.id)) ? 'Clear selection' : `Select all ${free.length} shown`}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted">Weight sets how much each activity counts in overall physical progress. By BOQ amount, a ₹36 lakh item counts 36 times a ₹1 lakh item.</p>
            <div className="max-h-[50vh] space-y-3 overflow-y-auto">
              {groups.map(([section, items]) => (
                <section key={section}>
                  <h3 className="mb-1 border-b border-line pb-1 text-sm font-semibold text-ink">{section}</h3>
                  <ul className="divide-y divide-line">
                    {items.map((r) => (
                      <li key={r.id} className={cx('flex items-start gap-2 py-1.5', r.activities.length > 0 && 'opacity-60')}>
                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" aria-label={`BOQ ${r.itemCode}`} disabled={r.activities.length > 0} checked={picked.has(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{r.itemCode}</span> <span className="text-ink">{r.description}</span>
                          <span className="block text-xs text-muted">{num(r.qty).toLocaleString('en-IN')} {r.unit} · {formatMoney(r.amount)}</span>
                        </span>
                        {r.activities.length > 0 && <Badge tone="success">Activity {r.activities.join(', ')}</Badge>}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

const NATIONAL_HOLIDAYS: Array<[string, string]> = [
  ['01-26', 'Republic Day'],
  ['05-01', 'May Day'],
  ['08-15', 'Independence Day'],
  ['10-02', 'Gandhi Jayanti'],
  ['12-25', 'Christmas'],
];

/** Work week and holidays of the project: forecast dates, durations and floats count working days only. */
function CalendarButton({ manage }: { manage: boolean }) {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ workWeek: string; holidays: Array<{ date: string; name: string }> } | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const q = useQuery({ queryKey: ['p', 'schedule-calendar', projectId], queryFn: () => api.get<{ workWeek: string; holidays: Array<{ date: string; name: string }> }>(`/projects/${projectId}/schedule/calendar`), enabled: open });
  const d = draft ?? q.data ?? null;
  const save = useMutation({
    mutationFn: () => api.put(`/projects/${projectId}/schedule/calendar`, d),
    onSuccess: () => {
      toast.success('Working calendar saved. Forecast dates now count working days only.');
      setOpen(false);
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['p'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (next: Partial<NonNullable<typeof d>>) => d && setDraft({ ...d, ...next });
  const sortHol = (h: Array<{ date: string; name: string }>) => [...h].sort((a, b) => a.date.localeCompare(b.date));
  const year = new Date().getUTCFullYear();
  const addNational = (y: number) => {
    if (!d) return;
    const have = new Set(d.holidays.map((h) => h.date));
    set({ holidays: sortHol([...d.holidays, ...NATIONAL_HOLIDAYS.map(([md, name]) => ({ date: `${y}-${md}`, name })).filter((h) => !have.has(h.date))]) });
  };
  const days = d ? [...d.workWeek].filter((c) => c === '1').length : 0;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Working calendar</Button>
      <Dialog
        open={open}
        onOpenChange={(o) => { setOpen(o); if (!o) setDraft(null); }}
        size="lg"
        title="Working calendar"
        description="Days the site works. Durations, lags and float count working days only, and forecast dates never fall on a holiday or a day off."
        footer={
          manage ? (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button loading={save.isPending} disabled={!d || !draft} onClick={() => save.mutate()}>Save calendar</Button>
            </>
          ) : undefined
        }
      >
        {!d ? (
          <LoadingBlock rows={4} />
        ) : (
          <div className="space-y-4 text-sm">
            <div>
              <p className="mb-2 font-medium text-ink">Work week ({days} day{days === 1 ? '' : 's'})</p>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((w, i) => {
                  const on = d.workWeek[i] === '1';
                  return (
                    <button
                      key={w}
                      type="button"
                      disabled={!manage}
                      aria-pressed={on}
                      className={cx('w-14 rounded-lg border px-2 py-1.5 text-sm font-medium', on ? 'border-navy-800 bg-navy-800 text-white' : 'border-line bg-white text-muted')}
                      onClick={() => {
                        const next = d.workWeek.slice(0, i) + (on ? '0' : '1') + d.workWeek.slice(i + 1);
                        if (next.includes('1')) set({ workWeek: next });
                      }}
                    >
                      {w}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-ink">Holidays ({d.holidays.length})</p>
                {manage && (
                  <span className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => addNational(year)}>+ National holidays {year}</Button>
                    <Button size="sm" variant="ghost" onClick={() => addNational(year + 1)}>+ {year + 1}</Button>
                  </span>
                )}
              </div>
              {manage && (
                <div className="mb-2 flex flex-wrap items-end gap-2">
                  <Input type="date" aria-label="Holiday date" className="w-44" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                  <Input aria-label="Holiday name" className="min-w-40 flex-1" placeholder="e.g. Pongal, Diwali, site shutdown" value={newName} onChange={(e) => setNewName(e.target.value)} />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!newDate || !newName.trim() || d.holidays.some((h) => h.date === newDate)}
                    onClick={() => {
                      set({ holidays: sortHol([...d.holidays, { date: newDate, name: newName.trim() }]) });
                      setNewDate('');
                      setNewName('');
                    }}
                  >
                    Add
                  </Button>
                </div>
              )}
              {d.holidays.length ? (
                <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                  {d.holidays.map((h) => (
                    <li key={h.date} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span><span className="tabular-nums">{formatDate(h.date)}</span> · {h.name}</span>
                      {manage && <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => set({ holidays: d.holidays.filter((x) => x.date !== h.date) })}>Remove</button>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">No holidays yet. Add festival days (Pongal, Diwali…) and planned site shutdowns.</p>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

/** Saves today's plan as the baseline (planned → baseline dates), so later slips can be measured against it. */
function BaselineButton() {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [replace, setReplace] = useState(false);
  const q = useQuery({
    queryKey: ['p', 'schedule-baseline', projectId],
    queryFn: () => api.get<{ total: number; dated: number; withBaseline: number; changedSinceBaseline: number; lastSavedAt: string | null }>(`/projects/${projectId}/schedule/baseline`),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: () => api.post<{ saved: number; kept: number; undated: number }>(`/projects/${projectId}/schedule/baseline`, { replace }),
    onSuccess: (r) => {
      toast.success(`Baseline saved for ${r.saved} activit${r.saved === 1 ? 'y' : 'ies'}${r.kept ? `; ${r.kept} kept their earlier baseline` : ''}${r.undated ? `; ${r.undated} without planned dates skipped` : ''}`);
      setOpen(false);
      setReplace(false);
      void qc.invalidateQueries({ queryKey: ['p'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const d = q.data;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Save baseline</Button>
      <Dialog
        open={open}
        onOpenChange={(o) => { setOpen(o); if (!o) setReplace(false); }}
        title="Save the schedule baseline"
        description="Copies each activity's planned start and finish to its baseline dates: the approved plan that delays are measured against. Do this once the programme is agreed; re-baseline only when a revised programme is approved (e.g. after an extension of time)."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={save.isPending} disabled={!d?.dated || (!replace && d.withBaseline >= d.dated)} onClick={() => save.mutate()}>{replace ? 'Re-baseline all activities' : 'Save baseline'}</Button>
          </>
        }
      >
        {!d ? (
          <LoadingBlock rows={3} />
        ) : (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              <li>{d.dated} of {d.total} activities have planned dates.</li>
              <li>{d.withBaseline} already have a baseline{d.lastSavedAt ? ` (last saved ${formatDate(d.lastSavedAt)})` : ''}.</li>
              {!replace && d.dated > 0 && d.withBaseline >= d.dated && <li className="text-muted">Every dated activity already has a baseline (an imported schedule is baselined on import). Tick “Replace” below to re-baseline.</li>}
              {d.changedSinceBaseline > 0 && <li className="text-amber-800">{d.changedSinceBaseline} activit{d.changedSinceBaseline === 1 ? 'y has' : 'ies have'} planned dates that differ from the baseline.</li>}
            </ul>
            {d.withBaseline > 0 && (
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                <span>Replace existing baselines too (re-baseline). Otherwise only activities without a baseline get one.</span>
              </label>
            )}
            <p className="text-xs text-muted">Recorded in the audit trail.</p>
          </div>
        )}
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ Equipment utilisation */

interface EqLog extends Rec {
  equipmentId: string;
  date: string;
  workingHours: string;
  idleHours: string;
  breakdownHours: string;
  fuelLitres: string;
  fuelCost: string;
  amount: string | null;
  status: string;
}

export function EquipmentUtilisation() {
  const projectId = useProjectId();
  const { can, project } = useAuth();
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10));
  const [to, setTo] = useState(todayIso());
  const q = useQuery({
    queryKey: ['p', 'eq-util', projectId, from, to],
    queryFn: () => api.get<Paged<EqLog>>(`/projects/${projectId}/r/equipmentLogs`, { pageSize: 200, from, to }),
  });
  const rows = useMemo(() => {
    const m = new Map<string, { id: string; name: string; days: number; working: number; idle: number; breakdown: number; fuel: number; fuelCost: number; cost: number; pending: number }>();
    for (const l of q.data?.items ?? []) {
      if (l.status === 'REJECTED' || l.status === 'CANCELLED') continue;
      const r = m.get(l.equipmentId) ?? { id: l.equipmentId, name: l._labels?.equipmentId ?? '—', days: 0, working: 0, idle: 0, breakdown: 0, fuel: 0, fuelCost: 0, cost: 0, pending: 0 };
      r.days++;
      r.working += num(l.workingHours);
      r.idle += num(l.idleHours);
      r.breakdown += num(l.breakdownHours);
      r.fuel += num(l.fuelLitres);
      r.fuelCost += num(l.fuelCost);
      if (l.status === 'APPROVED') r.cost += num(l.amount);
      else r.pending++;
      m.set(l.equipmentId, r);
    }
    return [...m.values()].sort((a, b) => b.working - a.working);
  }, [q.data]);
  if (!can('equipment.view')) return <PermissionDenied />;
  const cur = project?.currency;
  const util = (r: (typeof rows)[number]) => {
    const t = r.working + r.idle + r.breakdown;
    return t ? (r.working / t) * 100 : 0;
  };
  const truncated = (q.data?.total ?? 0) > (q.data?.items.length ?? 0);
  return (
    <>
      <PageHeader title="Equipment utilisation" subtitle="Utilisation = working hours ÷ (working + idle + breakdown) hours, from daily logs. Cost counts approved logs only (owned equipment posts actual cost on approval)." />
      <Card bodyClassName="p-0" className="mb-4">
        <div className="flex flex-wrap items-end gap-3 p-3">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          {truncated && <p className="text-xs text-amber-700">Showing the first 200 logs; narrow the date range for complete totals.</p>}
        </div>
      </Card>
      {q.isLoading ? (
        <LoadingBlock rows={5} />
      ) : !rows.length ? (
        <EmptyState title="No equipment logs in this period" description="Daily equipment logs feed this view." />
      ) : (
        <div className="space-y-4">
          <ChartCard
            title="Hours by equipment"
            legend={[{ label: 'Working', color: SERIES[0] }, { label: 'Idle', color: SERIES[3] }, { label: 'Breakdown', color: SERIES[1] }]}
            chart={
              <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 34 + 40)}>
                <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }} barCategoryGap={6}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" {...axisProps} />
                  <YAxis type="category" dataKey="name" width={150} {...axisProps} />
                  <Tooltip content={<ChartTooltip money={false} suffix=" h" />} cursor={{ fill: 'rgba(42,120,214,0.06)' }} />
                  <Bar dataKey="working" name="Working" stackId="h" fill={SERIES[0]} stroke="#fff" strokeWidth={1} />
                  <Bar dataKey="idle" name="Idle" stackId="h" fill={SERIES[3]} stroke="#fff" strokeWidth={1} />
                  <Bar dataKey="breakdown" name="Breakdown" stackId="h" fill={SERIES[1]} stroke="#fff" strokeWidth={1} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            }
            table={{ columns: ['Equipment', 'Working h', 'Idle h', 'Breakdown h'], rows: rows.map((r) => [r.name, r.working.toFixed(1), r.idle.toFixed(1), r.breakdown.toFixed(1)]) }}
          />
          <Card bodyClassName="p-0">
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              dense
              columns={[
                { key: 'n', header: 'Equipment', cell: (r) => <span className="font-medium">{r.name}</span> },
                { key: 'd', header: 'Log days', align: 'right', cell: (r) => r.days },
                { key: 'w', header: 'Working h', align: 'right', cell: (r) => r.working.toFixed(1) },
                { key: 'i', header: 'Idle h', align: 'right', cell: (r) => r.idle.toFixed(1), hideOnMobile: true },
                { key: 'b', header: 'Breakdown h', align: 'right', cell: (r) => r.breakdown.toFixed(1), hideOnMobile: true },
                { key: 'u', header: 'Utilisation', align: 'right', cell: (r) => <span className={cx(util(r) < 60 && 'font-semibold text-amber-700')}>{util(r).toFixed(1)}%</span> },
                { key: 'f', header: 'Fuel (L)', align: 'right', cell: (r) => r.fuel.toFixed(0), hideOnMobile: true },
                { key: 'c', header: 'Approved cost', align: 'right', cell: (r) => <span>{formatMoney(String(r.cost), cur)}{r.pending > 0 && <span className="block text-[11px] text-muted">{r.pending} log(s) pending</span>}</span> },
              ]}
            />
          </Card>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ Measurement verification queue */

interface Measurement extends Rec {
  number: string;
  type: string;
  boqItemId: string;
  measuredOn: string;
  location: string | null;
  grid: string | null;
  formula: string | null;
  calculatedQty: string | null;
  submittedQty: string | null;
  verifiedQty: string | null;
  variance: string | null;
  unit: string | null;
  status: string;
  createdById: string;
  submittedById: string | null;
}

export function VerificationQueuePage() {
  const projectId = useProjectId();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState('SUBMITTED');
  const [verify, setVerify] = useState<Measurement | null>(null);
  const [form, setForm] = useState({ verifiedQty: '', note: '' });
  const [ret, setRet] = useState<Measurement | null>(null);
  const q = useQuery({
    queryKey: ['p', 'mqueue', projectId, tab],
    queryFn: () => api.get<Paged<Measurement>>(`/projects/${projectId}/r/measurements`, { status: tab, pageSize: 100, sort: 'measuredOn', dir: 'asc' }),
  });
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['p'] });
  };
  const verifyM = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/measurements/${verify!.id}/verify`, { verifiedQty: form.verifiedQty, note: form.note || undefined }),
    onSuccess: () => { toast.success('Measurement verified'); setVerify(null); done(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const returnM = useMutation({
    mutationFn: (note: string) => api.post(`/projects/${projectId}/measurements/${ret!.id}/return-for-correction`, { note }),
    onSuccess: () => { toast.success('Returned for correction'); setRet(null); done(); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!can('measurement.view')) return <PermissionDenied />;
  const approver = can('measurement.approve');
  const own = (m: Measurement) => m.createdById === me?.user.id || m.submittedById === me?.user.id;
  const variancePreview = verify && form.verifiedQty ? num(form.verifiedQty) - num(verify.submittedQty) : null;
  return (
    <>
      <PageHeader title="Measurement verification" subtitle="Site engineers verify contractor-submitted quantities. The person who recorded a measurement cannot verify it. Verified quantities then go to the QS for certification through the approval workflow." />
      <Card bodyClassName="p-0">
        <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'SUBMITTED', label: 'Awaiting verification' }, { value: 'VERIFIED', label: 'Verified — to certify' }, { value: 'PENDING_CERTIFICATION', label: 'In certification' }, { value: 'RETURNED', label: 'Returned' }]} className="px-4 pt-1">
          <TabPanel value={tab} className="py-3">
            <DataTable
              rows={q.data?.items}
              loading={q.isLoading}
              error={q.error}
              rowKey={(m) => m.id}
              dense
              onRowClick={(m) => navigate(`/measurements/${m.id}`)}
              empty={{ title: 'Queue is empty', description: 'Nothing in this stage right now.' }}
              columns={[
                { key: 'n', header: 'Ref', cell: (m) => <span><span className="block font-medium text-navy-800">{m.number}</span><span className="text-xs text-muted">{m.type} · {formatDate(m.measuredOn)}</span></span> },
                { key: 'b', header: 'BOQ item', cell: (m) => m._labels?.boqItemId ?? '—' },
                { key: 'l', header: 'Location', cell: (m) => [m.location, m.grid].filter(Boolean).join(' · ') || '—', hideOnMobile: true },
                { key: 'f', header: 'Formula', cell: (m) => <span className="font-mono text-xs">{m.formula ?? '—'}</span>, hideOnMobile: true },
                { key: 's', header: 'Submitted', align: 'right', cell: (m) => `${formatQty(m.submittedQty ?? m.calculatedQty ?? '0', 3)} ${m.unit ?? ''}` },
                { key: 'v', header: 'Verified', align: 'right', cell: (m) => (m.verifiedQty ? <span>{formatQty(m.verifiedQty, 3)}{num(m.variance) !== 0 && <span className="block text-[11px] text-amber-700">Δ {formatQty(m.variance ?? '0', 3)}</span>}</span> : '—') },
                {
                  key: 'a',
                  header: '',
                  align: 'right',
                  cell: (m) =>
                    tab === 'SUBMITTED' && approver ? (
                      own(m) ? (
                        <span className="text-xs text-muted" title="Separation of duties">Recorded by you</span>
                      ) : (
                        <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => { setVerify(m); setForm({ verifiedQty: String(num(m.submittedQty ?? m.calculatedQty)), note: '' }); }}>Verify</Button>
                          <Button size="sm" variant="outline" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setRet(m)}>Return</Button>
                        </span>
                      )
                    ) : tab === 'VERIFIED' ? (
                      <span className="text-xs text-muted">Submit for certification from the record</span>
                    ) : null,
                },
              ]}
            />
          </TabPanel>
        </Tabs>
      </Card>
      <Dialog
        open={!!verify}
        onOpenChange={(o) => !o && setVerify(null)}
        title={`Verify ${verify?.number ?? ''}`}
        description="Enter the quantity confirmed on site. Any difference from the submitted quantity is recorded as variance."
        footer={<Button loading={verifyM.isPending} disabled={!form.verifiedQty || Number.isNaN(Number(form.verifiedQty)) || Number(form.verifiedQty) < 0} onClick={() => verifyM.mutate()}>Verify measurement</Button>}
      >
        {verify && (
          <div className="space-y-3">
            <p className="text-sm">
              Submitted: <strong>{formatQty(verify.submittedQty ?? verify.calculatedQty ?? '0', 3)} {verify.unit}</strong> · BOQ {verify._labels?.boqItemId}
            </p>
            <Field label={`Verified quantity (${verify.unit ?? ''})`} required>
              <Input inputMode="decimal" value={form.verifiedQty} onChange={(e) => setForm({ ...form, verifiedQty: e.target.value })} />
            </Field>
            {variancePreview !== null && variancePreview !== 0 && <p className="text-xs text-amber-700">Variance: {variancePreview.toFixed(3)} {verify.unit}</p>}
            <Field label="Verification note"><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={!!ret} onOpenChange={(o) => !o && setRet(null)} title={`Return ${ret?.number ?? ''} for correction`} message="The recorder is notified with your note and can resubmit after correcting." requireReason reasonLabel="What needs correcting" confirmLabel="Return" loading={returnM.isPending} onConfirm={(n) => returnM.mutate(n)} />
    </>
  );
}
