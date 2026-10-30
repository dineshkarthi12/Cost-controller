import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera, ClipboardList, Download, HardHat, IndianRupee, Pencil, Plus, Sunrise, Sunset, Trash2, TrendingUp, Users } from 'lucide-react';
import { defaultCrewSplit, gangProductivity, GANG_PROGRESS, LABOUR_UNITS, summariseProductivity, type GangProgress, type LabourNormInput, type ProductivityResult } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDate, formatMoney, todayIso } from '../../lib/format';
import { shrinkImage } from '../../lib/images';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, KpiCard, LoadingBlock, PermissionDenied, Select, Textarea, cx } from '../../components/ui';
import { RefSelect, type RefOption } from '../../components/forms/RefSelect';
import { PageHeader } from '../../components/layout/AppShell';

/* ------------------------------------------------------------------ types */

interface NormInfo extends LabourNormInput {
  id: string;
  code: string;
  name: string;
  unit: string;
}
interface Gang {
  id: string;
  lineNo: number;
  work: string;
  workers: string[];
  masons: number;
  helpers: number;
  normId: string | null;
  norm: NormInfo | null;
  doneQty: string | null;
  unit: string | null;
  progress: GangProgress;
  outcome: string | null;
  labourCost: string;
  outputPct: string | null;
  result: ProductivityResult;
  profitLoss: string;
}
interface Summary {
  masonDays: number;
  helperDays: number;
  labourCost: string;
  workDone: Record<string, string>;
  outputPct: string | null;
  result: ProductivityResult;
  profitLoss: string;
}
interface Report {
  id: string;
  date: string;
  status: 'PLANNED' | 'COMPLETED';
  masonRate: string;
  helperRate: string;
  remarks: string | null;
  updatedAt: string;
  gangs: Gang[];
  summary: Summary;
  canManage?: boolean;
}
interface ListResponse {
  items: Array<{ id: string; date: string; status: string; labourCost: string; profitLoss: string; outputPct: string | null; masonDays: number; helperDays: number }>;
  canManage: boolean;
  rates: { masonRate: string; helperRate: string };
  aiConfigured: boolean;
}
interface Extracted {
  site: string | null;
  date: string | null;
  gangs: Array<{ workers: string[]; work: string; outcome: string | null; doneQty: number | null; unit: string | null; progress: GangProgress }>;
  unreadable: string[];
}
interface Draft {
  key: string;
  work: string;
  workersText: string;
  masons: string;
  helpers: string;
  crewTouched: boolean;
  normId: string | null;
  norm: NormInfo | null;
  doneQty: string;
  unit: string;
  progress: GangProgress;
  outcome: string;
}

/* ------------------------------------------------------------------ helpers */

const RESULT_TONE = { PROFIT: 'success', OK: 'info', LOSS: 'danger', NOT_MEASURED: 'neutral' } as const;
const RESULT_LABEL = { PROFIT: 'Profit', OK: 'On norm', LOSS: 'Loss', NOT_MEASURED: 'Not measured' } as const;
const PROGRESS_LABEL: Record<GangProgress, string> = { PLANNED: 'Planned', IN_PROGRESS: 'In progress', DONE: 'Done' };
const pctText = (v: string | null | undefined) => (v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(1)}%`);
const plText = (v: string | number) => {
  const n = Number(v);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatMoney(String(Math.abs(n)))}`;
};
const plTone = (v: string | number) => (Number(v) > 0.5 ? 'text-emerald-700' : Number(v) < -0.5 ? 'text-red-600' : 'text-ink');
const splitNames = (t: string) => t.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
let keySeq = 0;
const newKey = () => `g${++keySeq}`;

function emptyDraft(): Draft {
  return { key: newKey(), work: '', workersText: '', masons: '0', helpers: '0', crewTouched: false, normId: null, norm: null, doneQty: '', unit: '', progress: 'PLANNED', outcome: '' };
}
function fromGang(g: Gang): Draft {
  return { key: newKey(), work: g.work, workersText: g.workers.join(', '), masons: String(g.masons), helpers: String(g.helpers), crewTouched: true, normId: g.normId, norm: g.norm, doneQty: g.doneQty ? String(Number(g.doneQty)) : '', unit: g.unit ?? '', progress: g.progress, outcome: g.outcome ?? '' };
}
function withNames(d: Draft, workersText: string): Draft {
  if (d.crewTouched) return { ...d, workersText };
  const crew = defaultCrewSplit(splitNames(workersText).length);
  return { ...d, workersText, masons: String(crew.masons), helpers: String(crew.helpers) };
}
const draftCalc = (d: Draft, rates: { masonRate: string; helperRate: string }) =>
  gangProductivity({ masons: Number(d.masons) || 0, helpers: Number(d.helpers) || 0, doneQty: d.doneQty || null, norm: d.norm }, rates);

/** Fills evening results into the morning gangs, matching by shared worker names, then by order. */
function mergeEvening(drafts: Draft[], ex: Extracted): Draft[] {
  const out = drafts.map((d) => ({ ...d }));
  const used = new Set<number>();
  const extra: Draft[] = [];
  ex.gangs.forEach((g, i) => {
    const names = new Set(g.workers.map((w) => w.toLowerCase()));
    let idx = out.findIndex((d, j) => !used.has(j) && splitNames(d.workersText).some((w) => names.has(w.toLowerCase())));
    if (idx < 0 && i < out.length && !used.has(i)) idx = i;
    const fill = { outcome: g.outcome ?? '', doneQty: g.doneQty !== null ? String(g.doneQty) : '', unit: g.unit ?? '', progress: g.progress };
    if (idx >= 0) {
      used.add(idx);
      out[idx] = { ...out[idx], ...fill, doneQty: fill.doneQty || out[idx].doneQty, unit: fill.unit || out[idx].unit };
    } else extra.push(withNames({ ...emptyDraft(), work: g.work, ...fill }, g.workers.join(', ')));
  });
  return [...out, ...extra];
}

/* ------------------------------------------------------------------ page */

export function DailyLabourPage() {
  const projectId = useProjectId();
  const { can } = useAuth();
  const [date, setDate] = useState(todayIso());
  const [editing, setEditing] = useState<null | { stage: 'morning' | 'evening'; drafts: Draft[]; photo?: File; notes?: string[] }>(null);
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['p', 'dlr-list', projectId, date], queryFn: () => api.get<ListResponse>(`/projects/${projectId}/labour-reports`, { date }), enabled: !!projectId });
  const reportId = list.data?.items[0]?.id;
  const report = useQuery({ queryKey: ['p', 'dlr', projectId, reportId], queryFn: () => api.get<Report>(`/projects/${projectId}/labour-reports/${reportId}`), enabled: !!reportId });

  if (!can('manpower.view')) return <PermissionDenied />;
  const manage = list.data?.canManage ?? false;
  const rates = report.data ? { masonRate: report.data.masonRate, helperRate: report.data.helperRate } : (list.data?.rates ?? { masonRate: '0', helperRate: '0' });
  const done = () => {
    setEditing(null);
    void qc.invalidateQueries({ queryKey: ['p'] });
  };

  return (
    <div>
      <PageHeader
        title="Daily labour report"
        subtitle="Morning: who works on what. Evening: how much they finished. The app compares the work with the per-day norm and shows profit or loss."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Date" htmlFor="dlr-date">
              <Input id="dlr-date" type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && (setEditing(null), setDate(e.target.value))} />
            </Field>
            <a className="inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors border border-line bg-white text-ink hover:bg-slate-50" href={api.url('/labour-reports/export', { date, projectId })} download>
              <Download className="h-4 w-4" /> Excel
            </a>
          </div>
        }
      />
      {list.isLoading || (reportId && report.isLoading) ? (
        <LoadingBlock rows={5} />
      ) : editing ? (
        <ReportEditor key={editing.stage + date} projectId={projectId} date={date} report={report.data ?? null} stage={editing.stage} initial={editing.drafts} photo={editing.photo} notes={editing.notes} rates={rates} onCancel={() => setEditing(null)} onSaved={done} />
      ) : !report.data ? (
        <NoReport date={date} manage={manage} aiConfigured={list.data?.aiConfigured ?? false} projectId={projectId} onStart={(drafts, photo, notes) => setEditing({ stage: 'morning', drafts, photo, notes })} />
      ) : (
        <ReportView
          report={report.data}
          projectId={projectId}
          manage={manage}
          aiConfigured={list.data?.aiConfigured ?? false}
          onEdit={(stage, drafts, photo, notes) => setEditing({ stage, drafts: drafts ?? report.data!.gangs.map(fromGang), photo, notes })}
          onDeleted={done}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ photo reading */

function usePhotoReader(projectId: string, stage: 'morning' | 'evening', onRead: (ex: Extracted, photo: File) => void) {
  const input = useRef<HTMLInputElement>(null);
  const m = useMutation({
    mutationFn: async (file: File) => {
      const small = await shrinkImage(file, 4.5 * 1024 * 1024);
      const f = new FormData();
      f.append('stage', stage);
      f.append('photo', small);
      return { ex: await api.upload<Extracted>(`/projects/${projectId}/labour-reports/extract`, f), photo: small };
    },
    onSuccess: ({ ex, photo }) => {
      if (!ex.gangs.length) return toast.error('No work rows could be read from this photo. Try a clearer photo, or type it.');
      toast.success(`Read ${ex.gangs.length} work rows. Check names and quantities before saving.`);
      onRead(ex, photo);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      capture="environment"
      className="hidden"
      aria-label="Labour sheet photo"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) m.mutate(f);
      }}
    />
  );
  return { open: () => input.current?.click(), picker, reading: m.isPending };
}

function PhotoButton({ aiConfigured, reader, label }: { aiConfigured: boolean; reader: ReturnType<typeof usePhotoReader>; label: string }) {
  return (
    <>
      {reader.picker}
      <Button variant="outline" icon={<Camera className="h-4 w-4" />} loading={reader.reading} disabled={!aiConfigured} onClick={reader.open} title={aiConfigured ? undefined : 'Needs an Anthropic API key set by the administrator'}>
        {reader.reading ? 'Reading the photo…' : label}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ no report yet */

function NoReport({ date, manage, aiConfigured, projectId, onStart }: { date: string; manage: boolean; aiConfigured: boolean; projectId: string; onStart: (d: Draft[], photo?: File, notes?: string[]) => void }) {
  const reader = usePhotoReader(projectId, 'morning', (ex, photo) => onStart(ex.gangs.map((g) => withNames({ ...emptyDraft(), work: g.work }, g.workers.join(', '))), photo, ex.unreadable));
  return (
    <Card>
      <EmptyState
        icon={<Sunrise className="h-6 w-6" />}
        title={`No labour report for ${formatDate(date)}`}
        description={manage ? 'Start with the morning allocation: take a photo of the handwritten sheet, or type it.' : 'Nothing has been entered for this day yet.'}
        action={
          manage ? (
            <div className="flex flex-wrap justify-center gap-2">
              <PhotoButton aiConfigured={aiConfigured} reader={reader} label="Read sheet photo" />
              <Button icon={<Pencil className="h-4 w-4" />} onClick={() => onStart([emptyDraft()])}>
                Type manually
              </Button>
            </div>
          ) : undefined
        }
      />
      {manage && !aiConfigured && <p className="mt-2 text-center text-xs text-muted">Photo reading is switched off: the administrator needs to add an Anthropic API key (ANTHROPIC_API_KEY). Typing works without it.</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ view */

function SummaryTiles({ s }: { s: Summary }) {
  const done = Object.entries(s.workDone).map(([u, q]) => `${Number(q)} ${u}`).join(' · ');
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard label="Labour used" value={`${s.masonDays} masons · ${s.helperDays} helpers`} icon={<Users className="h-5 w-5" />} />
      <KpiCard label="Labour cost" value={formatMoney(s.labourCost)} icon={<IndianRupee className="h-5 w-5" />} sub={done ? `Work measured: ${done}` : 'No work measured yet'} />
      <KpiCard label="Output vs norm" value={pctText(s.outputPct)} icon={<TrendingUp className="h-5 w-5" />} tone={s.outputPct === null ? 'neutral' : Number(s.outputPct) >= 1 ? 'success' : 'danger'} sub="100% = exactly as per norm" />
      <KpiCard label="Profit / loss on labour" value={<span className={plTone(s.profitLoss)}>{s.result === 'NOT_MEASURED' ? '—' : plText(s.profitLoss)}</span>} icon={<HardHat className="h-5 w-5" />} tone={s.result === 'PROFIT' ? 'success' : s.result === 'LOSS' ? 'danger' : 'neutral'} sub={RESULT_LABEL[s.result]} />
    </div>
  );
}

function ReportView({ report, projectId, manage, aiConfigured, onEdit, onDeleted }: { report: Report; projectId: string; manage: boolean; aiConfigured: boolean; onEdit: (stage: 'morning' | 'evening', drafts?: Draft[], photo?: File, notes?: string[]) => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const reader = usePhotoReader(projectId, 'evening', (ex, photo) => onEdit('evening', mergeEvening(report.gangs.map(fromGang), ex), photo, ex.unreadable));
  const del = useMutation({ mutationFn: (reason: string) => fetch(api.url(`/projects/${projectId}/labour-reports/${report.id}`), { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'toprock' }, body: JSON.stringify({ reason }) }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error?.message ?? 'Could not delete'); }), onSuccess: () => { toast.success('Report deleted'); onDeleted(); }, onError: (e: Error) => toast.error(e.message) });
  const photos = useQuery({ queryKey: ['p', 'dlr-photos', report.id], queryFn: () => api.get<Array<{ id: string; label: string; fileId: string; createdAt: string }>>(`/projects/${projectId}/attachments`, { entityType: 'dailyLabourReport', entityId: report.id }) });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {report.status === 'COMPLETED' ? <Badge tone="success"><Sunset className="mr-1 inline h-3.5 w-3.5" />Evening measured</Badge> : <Badge tone="warning"><Sunrise className="mr-1 inline h-3.5 w-3.5" />Morning plan · evening update pending</Badge>}
          <span className="text-xs text-muted">Rates: mason {formatMoney(report.masonRate)} · helper {formatMoney(report.helperRate)} per day</span>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <PhotoButton aiConfigured={aiConfigured} reader={reader} label="Evening sheet photo" />
            <Button icon={<Sunset className="h-4 w-4" />} onClick={() => onEdit('evening')}>
              {report.status === 'COMPLETED' ? 'Edit evening update' : 'Evening update'}
            </Button>
            <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit('morning')}>
              Edit morning
            </Button>
            <Button variant="ghost" className="text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirm(true)}>
              Delete
            </Button>
          </div>
        )}
      </div>
      <SummaryTiles s={report.summary} />
      <Card title="Work and labour check" bodyClassName="p-0">
        <div className="divide-y divide-line md:hidden">
          {report.gangs.map((g) => (
            <div key={g.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{g.lineNo}. {g.work}</p>
                <Badge tone={RESULT_TONE[g.result]}>{RESULT_LABEL[g.result]}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">{g.workers.join(', ') || '—'}</p>
              <p className="mt-1 text-sm">{g.masons} mason · {g.helpers} helper · {formatMoney(g.labourCost)}</p>
              <p className="mt-1 text-sm">
                Done: <strong>{g.doneQty ? `${Number(g.doneQty)} ${g.unit ?? ''}` : (g.outcome || PROGRESS_LABEL[g.progress])}</strong>
                {g.outputPct !== null && <> · {pctText(g.outputPct)} · <span className={plTone(g.profitLoss)}>{plText(g.profitLoss)}</span></>}
              </p>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-muted uppercase">
              <tr>
                {['#', 'Work', 'Workers', 'Mason', 'Helper', 'Done', 'Norm / day', 'Output', 'Labour cost', 'Result', 'Profit / loss'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.gangs.map((g) => (
                <tr key={g.id} className="align-top">
                  <td className="px-3 py-2">{g.lineNo}</td>
                  <td className="px-3 py-2 font-medium">{g.work}<div className="text-xs font-normal text-muted">{PROGRESS_LABEL[g.progress]}{g.outcome ? ` · ${g.outcome}` : ''}</div></td>
                  <td className="max-w-56 px-3 py-2 text-muted">{g.workers.join(', ')}</td>
                  <td className="px-3 py-2 text-center">{g.masons}</td>
                  <td className="px-3 py-2 text-center">{g.helpers}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{g.doneQty ? `${Number(g.doneQty)} ${g.unit ?? ''}` : '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted">{g.norm ? `${Number(g.norm.outputPerDay)} ${g.norm.unit} · ${g.norm.masonsPerCrew}M+${g.norm.helpersPerCrew}H` : '—'}</td>
                  <td className="px-3 py-2 text-right">{pctText(g.outputPct)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatMoney(g.labourCost)}</td>
                  <td className="px-3 py-2"><Badge tone={RESULT_TONE[g.result]}>{RESULT_LABEL[g.result]}</Badge></td>
                  <td className={cx('px-3 py-2 text-right whitespace-nowrap', plTone(g.profitLoss))}>{g.result === 'NOT_MEASURED' ? '—' : plText(g.profitLoss)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {report.remarks && <Card title="Remarks"><p className="text-sm whitespace-pre-wrap">{report.remarks}</p></Card>}
      {!!photos.data?.length && (
        <Card title="Sheet photos">
          <ul className="flex flex-wrap gap-3 text-sm">
            {photos.data.map((p) => <li key={p.id}><a className="text-brand-700 underline" href={api.url(`/files/${p.fileId}`)} target="_blank" rel="noreferrer">{p.label}</a></li>)}
          </ul>
        </Card>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete this labour report?" message="The report for this day is removed. The deletion and your reason are kept in the audit trail." confirmLabel="Delete" tone="danger" requireReason reasonLabel="Reason" loading={del.isPending} onConfirm={(reason) => del.mutate(reason)} />
    </div>
  );
}

/* ------------------------------------------------------------------ editor */

function ReportEditor({ projectId, date, report, stage, initial, photo, notes, rates, onCancel, onSaved }: { projectId: string; date: string; report: Report | null; stage: 'morning' | 'evening'; initial: Draft[]; photo?: File; notes?: string[]; rates: { masonRate: string; helperRate: string }; onCancel: () => void; onSaved: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>(initial.length ? initial : [emptyDraft()]);
  const [remarks, setRemarks] = useState(report?.remarks ?? '');
  const evening = stage === 'evening';
  const names = useQuery({ queryKey: ['p', 'dlr-names', projectId], queryFn: () => api.get<string[]>(`/projects/${projectId}/labour-reports/worker-names`) });
  const set = (key: string, patch: Partial<Draft> | ((d: Draft) => Draft)) => setDrafts((all) => all.map((d) => (d.key === key ? (typeof patch === 'function' ? patch(d) : { ...d, ...patch }) : d)));
  const calcs = drafts.map((d) => draftCalc(d, rates));
  const totals = summariseProductivity(drafts.map((d, i) => ({ masons: Number(d.masons) || 0, helpers: Number(d.helpers) || 0, doneQty: d.doneQty || null, norm: d.norm, unit: d.unit || d.norm?.unit, productivity: calcs[i] })));

  const save = useMutation({
    mutationFn: async () => {
      const gangs = drafts
        .filter((d) => d.work.trim() || d.workersText.trim())
        .map((d) => ({ work: d.work.trim() || 'Work', workers: splitNames(d.workersText), masons: Number(d.masons) || 0, helpers: Number(d.helpers) || 0, normId: d.normId, doneQty: d.doneQty.trim() || null, unit: d.unit || null, progress: d.progress, outcome: d.outcome.trim() || null }));
      if (!gangs.length) throw new Error('Add at least one work row');
      const body = { gangs, remarks: remarks.trim() || null, ...(evening ? { status: 'COMPLETED' } : {}) };
      const saved = report ? await api.put<Report>(`/projects/${projectId}/labour-reports/${report.id}`, { ...body, expectedUpdatedAt: report.updatedAt }) : await api.post<Report>(`/projects/${projectId}/labour-reports`, { ...body, date });
      if (photo) {
        const f = new FormData();
        f.append('entityType', 'dailyLabourReport');
        f.append('entityId', saved.id);
        f.append('label', `${evening ? 'Evening' : 'Morning'} sheet ${date}.jpg`);
        f.append('files', photo);
        await api.upload(`/projects/${projectId}/attachments`, f).catch(() => toast.warning('The report was saved, but the photo could not be stored (file storage may not be set up).'));
      }
      return saved;
    },
    onSuccess: () => {
      toast.success(evening ? 'Evening update saved' : 'Morning report saved');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">{evening ? <Sunset className="h-5 w-5 text-amber-600" /> : <Sunrise className="h-5 w-5 text-amber-500" />}{evening ? 'Evening update' : 'Morning allocation'} · {formatDate(date)}</h2>
            <p className="text-sm text-muted">{evening ? 'For each gang, choose the norm and enter the quantity finished. Work that cannot be measured can stay without a quantity.' : 'One row per gang: what they will do and who is in it. Masons and helpers fill in automatically (1 mason, rest helpers); change them if needed.'}</p>
          </div>
          <div className="text-right text-sm">
            <p>{totals.masonDays} masons · {totals.helperDays} helpers · <strong>{formatMoney(totals.labourCost)}</strong></p>
            {evening && <p className={plTone(totals.profitLoss)}>{totals.result === 'NOT_MEASURED' ? 'Nothing measured yet' : `${pctText(totals.outputPct)} output · ${plText(totals.profitLoss)}`}</p>}
          </div>
        </div>
        {photo && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Filled from the photo. Handwriting can be misread: check every name and number before saving.
            {!!notes?.length && <span className="mt-1 block text-xs">Could not read: {notes.join('; ')}</span>}
          </div>
        )}
      </Card>

      <datalist id="dlr-worker-names">{(names.data ?? []).map((n) => <option key={n} value={n} />)}</datalist>
      {drafts.map((d, i) => {
        const c = calcs[i];
        return (
          <Card key={d.key}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-muted">Gang {i + 1}</span>
              <div className="flex items-center gap-2">
                {evening && <Badge tone={RESULT_TONE[c.result]}>{c.result === 'NOT_MEASURED' ? 'Not measured' : `${pctText(c.outputPct)} · ${plText(c.profitLoss)}`}</Badge>}
                <span className="text-sm">{formatMoney(c.labourCost)}</span>
                {drafts.length > 1 && <Button size="sm" variant="ghost" className="text-red-600" aria-label={`Remove gang ${i + 1}`} onClick={() => setDrafts(drafts.filter((x) => x.key !== d.key))}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-6">
              <Field label="Work / activity" htmlFor={`${d.key}-work`} className="sm:col-span-3">
                <Input id={`${d.key}-work`} value={d.work} placeholder="e.g. Glue filling work" onChange={(e) => set(d.key, { work: e.target.value })} />
              </Field>
              <Field label="Masons" htmlFor={`${d.key}-m`}>
                <Input id={`${d.key}-m`} inputMode="numeric" value={d.masons} onChange={(e) => set(d.key, { masons: e.target.value.replace(/\D/g, ''), crewTouched: true })} />
              </Field>
              <Field label="Helpers" htmlFor={`${d.key}-h`}>
                <Input id={`${d.key}-h`} inputMode="numeric" value={d.helpers} onChange={(e) => set(d.key, { helpers: e.target.value.replace(/\D/g, ''), crewTouched: true })} />
              </Field>
              <Field label="Workers" htmlFor={`${d.key}-w`} help="Separate names with commas" className="sm:col-span-6">
                <Textarea id={`${d.key}-w`} rows={2} value={d.workersText} placeholder="Anuj, Munna" onChange={(e) => set(d.key, (x) => withNames(x, e.target.value))} />
                <AddName onAdd={(n) => set(d.key, (x) => withNames(x, [...splitNames(x.workersText), n].join(', ')))} />
              </Field>
              {evening && (
                <>
                  <Field label="Per-day norm" className="sm:col-span-3" help={d.norm ? `${Number(d.norm.outputPerDay)} ${d.norm.unit}/day for ${d.norm.masonsPerCrew} mason + ${d.norm.helpersPerCrew} helper` : 'Choose one to measure productivity'}>
                    <RefSelect
                      source="labourNorms"
                      label="Per-day norm"
                      value={d.normId}
                      initialLabel={d.norm ? `${d.norm.name} — ${Number(d.norm.outputPerDay)} ${d.norm.unit}/day` : null}
                      onChange={(v, o?: RefOption) => set(d.key, { normId: v, norm: v && o?.extra ? { id: v, code: String(o.extra.code), name: o.label.replace(/ — .*$/, ''), unit: String(o.extra.unit), outputPerDay: String(o.extra.outputPerDay), masonsPerCrew: Number(o.extra.masonsPerCrew), helpersPerCrew: Number(o.extra.helpersPerCrew) } : null, unit: v && o?.extra?.unit ? String(o.extra.unit) : d.unit })}
                    />
                  </Field>
                  <Field label="Qty done" htmlFor={`${d.key}-q`}>
                    <Input id={`${d.key}-q`} inputMode="decimal" value={d.doneQty} placeholder="70" onChange={(e) => set(d.key, { doneQty: e.target.value.replace(/[^\d.]/g, '') })} />
                  </Field>
                  <Field label="Unit" htmlFor={`${d.key}-u`}>
                    <Select id={`${d.key}-u`} options={['', ...LABOUR_UNITS].map((u) => ({ value: u, label: u || '—' }))} value={d.unit} onChange={(e) => set(d.key, { unit: e.target.value })} />
                  </Field>
                  <Field label="Status" htmlFor={`${d.key}-p`}>
                    <Select id={`${d.key}-p`} options={GANG_PROGRESS.map((p) => ({ value: p, label: PROGRESS_LABEL[p] }))} value={d.progress} onChange={(e) => set(d.key, { progress: e.target.value as GangProgress })} />
                  </Field>
                  <Field label="Note (as written)" htmlFor={`${d.key}-o`} className="sm:col-span-5">
                    <Input id={`${d.key}-o`} value={d.outcome} placeholder="e.g. 20% work pending after store room lock fixing" onChange={(e) => set(d.key, { outcome: e.target.value })} />
                  </Field>
                </>
              )}
            </div>
          </Card>
        );
      })}
      <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setDrafts([...drafts, emptyDraft()])}>
        Add gang
      </Button>
      <Card>
        <Field label="Remarks" htmlFor="dlr-remarks">
          <Textarea id="dlr-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </Card>
      <div className="sticky bottom-16 z-10 flex justify-end gap-2 rounded-xl border border-line bg-white/95 p-3 shadow-sm md:bottom-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button loading={save.isPending} icon={<ClipboardList className="h-4 w-4" />} onClick={() => save.mutate()}>
          {evening ? 'Save evening update' : 'Save morning report'}
        </Button>
      </div>
    </div>
  );
}

/** Quick-add a known name (datalist suggestions from the worker register and earlier reports). */
function AddName({ onAdd }: { onAdd: (name: string) => void }) {
  const [v, setV] = useState('');
  const add = () => {
    if (v.trim()) onAdd(v.trim());
    setV('');
  };
  return (
    <div className="mt-2 flex gap-2">
      <Input list="dlr-worker-names" value={v} placeholder="Add a name…" aria-label="Add a worker name" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
      <Button size="sm" variant="outline" onClick={add} disabled={!v.trim()}>Add</Button>
    </div>
  );
}

/* ------------------------------------------------------------------ management summary */

interface SummaryRow extends Summary {
  id: string;
  projectId: string;
  project: { id: string; code: string; name: string };
  date: string;
  status: string;
  gangs: number;
}

export function LabourSummaryPage() {
  const { can } = useAuth();
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const q = useQuery({ queryKey: ['p', 'dlr-summary', from, to], queryFn: () => api.get<{ rows: SummaryRow[]; total: { masonDays: number; helperDays: number; labourCost: string; profitLoss: string; outputPct: string | null } }>('/labour-reports/summary', { from, to }) });
  if (!can('manpower.view')) return <PermissionDenied />;
  const t = q.data?.total;
  return (
    <div>
      <PageHeader
        title="Labour productivity summary"
        subtitle="All your sites in one place: labour used, work done against norms, and profit or loss on labour."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Field label="From" htmlFor="dls-from"><Input id="dls-from" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
            <Field label="To" htmlFor="dls-to"><Input id="dls-to" type="date" value={to} min={from} max={todayIso()} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
            <a className="inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors bg-navy-800 text-white shadow-sm hover:bg-navy-700" href={api.url('/labour-reports/export', { from, to })} download>
              <Download className="h-4 w-4" /> Download Excel
            </a>
          </div>
        }
      />
      {q.isLoading ? (
        <LoadingBlock rows={4} />
      ) : !q.data?.rows.length ? (
        <Card><EmptyState icon={<Users className="h-6 w-6" />} title="No labour reports in this period" description="Reports appear here once site engineers enter them under Manpower → Daily labour report." /></Card>
      ) : (
        <div className="space-y-4">
          {t && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Labour used" value={`${t.masonDays} masons · ${t.helperDays} helpers`} icon={<Users className="h-5 w-5" />} />
              <KpiCard label="Labour cost" value={formatMoney(t.labourCost)} icon={<IndianRupee className="h-5 w-5" />} />
              <KpiCard label="Output vs norm" value={pctText(t.outputPct)} icon={<TrendingUp className="h-5 w-5" />} tone={t.outputPct === null ? 'neutral' : Number(t.outputPct) >= 1 ? 'success' : 'danger'} sub="Measured work only" />
              <KpiCard label="Profit / loss on labour" value={<span className={plTone(t.profitLoss)}>{plText(t.profitLoss)}</span>} icon={<HardHat className="h-5 w-5" />} tone={Number(t.profitLoss) > 0 ? 'success' : Number(t.profitLoss) < 0 ? 'danger' : 'neutral'} />
            </div>
          )}
          <Card bodyClassName="p-0">
            <div className="divide-y divide-line md:hidden">
              {q.data.rows.map((r) => (
                <div key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{r.project.name}</p>
                    <Badge tone={RESULT_TONE[r.result]}>{RESULT_LABEL[r.result]}</Badge>
                  </div>
                  <p className="text-xs text-muted">{formatDate(r.date)} · {r.status === 'COMPLETED' ? 'evening measured' : 'morning plan only'}</p>
                  <p className="mt-1 text-sm">{r.masonDays} masons · {r.helperDays} helpers · {formatMoney(r.labourCost)}</p>
                  <p className="text-sm">{pctText(r.outputPct)} output · <span className={plTone(r.profitLoss)}>{r.result === 'NOT_MEASURED' ? '—' : plText(r.profitLoss)}</span></p>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-muted uppercase">
                  <tr>{['Project', 'Date', 'Masons', 'Helpers', 'Labour cost', 'Work done (measured)', 'Output', 'Result', 'Profit / loss'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {q.data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium">{r.project.name}{r.status !== 'COMPLETED' && <div className="text-xs font-normal text-amber-700">Evening update pending</div>}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="px-3 py-2 text-center">{r.masonDays}</td>
                      <td className="px-3 py-2 text-center">{r.helperDays}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{formatMoney(r.labourCost)}</td>
                      <td className="px-3 py-2 text-xs">{Object.entries(r.workDone).map(([u, v]) => `${Number(v)} ${u}`).join(' · ') || '—'}</td>
                      <td className="px-3 py-2 text-right">{pctText(r.outputPct)}</td>
                      <td className="px-3 py-2"><Badge tone={RESULT_TONE[r.result]}>{RESULT_LABEL[r.result]}</Badge></td>
                      <td className={cx('px-3 py-2 text-right whitespace-nowrap', plTone(r.profitLoss))}>{r.result === 'NOT_MEASURED' ? '—' : plText(r.profitLoss)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-xs text-muted">Output % = work done ÷ per-day norm ÷ crew. Profit / loss = labour cost × (output % − 1): positive means more work was done than the labour paid for. Work without a norm or quantity counts as labour used but is not measured. This is a productivity view; labour cost reaches the budget through verified manpower reports.</p>
        </div>
      )}
    </div>
  );
}
