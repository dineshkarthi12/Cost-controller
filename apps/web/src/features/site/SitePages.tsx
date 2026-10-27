import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarRange, CheckCircle2, ClipboardList, Flag, RotateCcw, Save, Users } from 'lucide-react';
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

export function SchedulePage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const q = useActivities();
  const [view, setView] = useState<'all' | 'lookahead'>('all');
  const now = Date.now();
  const acts = useMemo(() => {
    const all = (q.data?.items ?? []).filter((a) => a.plannedStart && a.plannedFinish);
    if (view === 'all') return all;
    const horizon = now + 21 * DAY;
    return all.filter((a) => a.status !== 'COMPLETED' && toTime(a.plannedStart)! <= horizon && toTime(a.plannedFinish)! >= now - 7 * DAY);
  }, [q.data, view, now]);
  if (!can('progress.view')) return <PermissionDenied />;
  const starts = acts.flatMap((a) => [toTime(a.plannedStart), toTime(a.actualStart)]).filter((x): x is number => x !== null);
  const ends = acts.flatMap((a) => [toTime(a.plannedFinish), toTime(a.actualFinish), a.actualStart && !a.actualFinish ? now : null]).filter((x): x is number => x !== null);
  const min = view === 'lookahead' ? now - 7 * DAY : Math.min(...starts);
  const max = view === 'lookahead' ? now + 21 * DAY : Math.max(...ends);
  const span = Math.max(max - min, DAY);
  const pos = (t: number) => `${Math.min(100, Math.max(0, ((t - min) / span) * 100))}%`;
  const width = (s: number, f: number) => `${Math.max(0.6, ((Math.min(f, max) - Math.max(s, min)) / span) * 100)}%`;
  const months: Array<{ t: number; label: string }> = [];
  if (acts.length) {
    const d = new Date(min);
    d.setUTCDate(1);
    for (let t = d.getTime(); t <= max; ) {
      const dt = new Date(t);
      if (t >= min) months.push({ t, label: dt.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }) });
      dt.setUTCMonth(dt.getUTCMonth() + 1);
      t = dt.getTime();
    }
  }
  const undated = (q.data?.items ?? []).length - (q.data?.items ?? []).filter((a) => a.plannedStart && a.plannedFinish).length;
  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle="Planned bars come from activity planned dates; actual bars from recorded actual start/finish. The look-ahead shows unfinished work in the next three weeks."
        actions={
          <>
            <Tabs value={view} onValueChange={(v) => setView(v as 'all' | 'lookahead')} tabs={[{ value: 'all', label: 'Full schedule' }, { value: 'lookahead', label: '3-week look-ahead' }]} />
            {can('progress.manage') && <Button variant="outline" onClick={() => navigate('/schedule/activities/new')}>Add activity</Button>}
          </>
        }
      />
      {q.isLoading ? (
        <LoadingBlock rows={8} />
      ) : !acts.length ? (
        <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={view === 'lookahead' ? 'Nothing scheduled in the look-ahead window' : 'No dated activities'} description="Activities need planned start and finish dates to appear on the Gantt chart." />
      ) : (
        <Card bodyClassName="p-0">
          <div className="flex flex-wrap items-center gap-4 border-b border-line px-4 py-2 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ background: '#c5d8f2' }} /> Planned</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ background: SERIES[0] }} /> Actual / in progress</span>
            <span className="flex items-center gap-1.5"><Flag className="h-3.5 w-3.5 text-brand-600" /> Milestone</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-0.5 bg-red-500" /> Today</span>
            {undated > 0 && <span className="ml-auto">{undated} activity(ies) without planned dates are hidden</span>}
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[260px_1fr] border-b border-line bg-surface-50 text-[11px] text-muted">
                <div className="px-3 py-1.5 font-medium">Activity</div>
                <div className="relative h-7">
                  {months.map((m) => (
                    <span key={m.t} className="absolute top-1.5 border-l border-line pl-1" style={{ left: pos(m.t) }}>
                      {m.label}
                    </span>
                  ))}
                </div>
              </div>
              {acts.map((a) => {
                const ps = toTime(a.plannedStart)!;
                const pf = toTime(a.plannedFinish)!;
                const as = toTime(a.actualStart);
                const af = toTime(a.actualFinish) ?? (as !== null ? now : null);
                const late = !a.actualFinish && pf < now;
                return (
                  <div key={a.id} className="grid grid-cols-[260px_1fr] border-b border-line last:border-0 hover:bg-surface-50">
                    <Link to={`/schedule/activities/${a.id}`} className="truncate px-3 py-2 text-sm hover:underline">
                      <span className="font-medium text-navy-800">{a.code}</span> <span className="text-muted">{a.name}</span>
                    </Link>
                    <div className="relative h-10" title={`${a.name}: planned ${formatDate(a.plannedStart)} – ${formatDate(a.plannedFinish)}, ${num(a.percentComplete).toFixed(0)}% complete`}>
                      {months.map((m) => <span key={m.t} className="absolute inset-y-0 border-l border-dashed" style={{ left: pos(m.t), borderColor: GRID }} />)}
                      {a.isMilestone ? (
                        <Flag className="absolute top-2.5 h-4 w-4 -translate-x-1/2 text-brand-600" style={{ left: pos(pf) }} aria-label={`Milestone ${formatDate(a.plannedFinish)}`} />
                      ) : (
                        <span className="absolute top-2 h-2.5 rounded" style={{ left: pos(ps), width: width(ps, pf), background: '#c5d8f2' }} />
                      )}
                      {as !== null && af !== null && <span className="absolute top-5 h-2.5 rounded" style={{ left: pos(as), width: width(as, af), background: late ? SERIES[1] : SERIES[0] }} />}
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
