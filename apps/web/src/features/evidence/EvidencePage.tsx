import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera, CheckCircle2, CloudOff, Download, ImagePlus, Loader2, RefreshCw, Trash2, Upload, XCircle } from 'lucide-react';
import { EVIDENCE_STATUS, humanize } from '@toprock/shared';
import { api, type Paged } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { enqueueUpload, processQueue, removeQueued, useOnline, useUploadQueue } from '../../lib/offline';
import { shrinkImage } from '../../lib/images';
import { fileSize, formatDateTime, relativeTime } from '../../lib/format';
import { Badge, Button, Card, DescriptionList, Dialog, EmptyState, Field, Input, LoadingBlock, Pagination, PermissionDenied, Select, StatusBadge, TabPanel, Tabs, Textarea, cx } from '../../components/ui';
import { RefSelect } from '../../components/forms/RefSelect';
import { Page, PageHeader } from '../../components/layout/AppShell';
import type { EvidenceRow } from '../../components/record/Panels';

const CATEGORIES = ['WORK_COMPLETION', 'MANPOWER', 'MEASUREMENT', 'MATERIAL_RECEIPT', 'MATERIAL_DAMAGE', 'EQUIPMENT', 'QUALITY', 'SAFETY', 'DRAWING', 'GENERAL'] as const;
const LINK_TYPES = [
  { value: 'measurement', label: 'Measurement', source: 'measurements' },
  { value: 'grn', label: 'GRN', source: 'grns' },
  { value: 'activity', label: 'Activity', source: 'activities' },
  { value: 'inspection', label: 'Inspection', source: 'inspections' },
  { value: 'ncr', label: 'NCR', source: 'ncrs' },
] as const;

function CaptureDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const projectId = useProjectId();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [f, setF] = useState<Record<string, string>>({ category: 'WORK_COMPLETION', caption: '', location: '', phase: 'NA', pairKey: '', linkedType: '', linkedId: '', activityId: '' });
  const [saving, setSaving] = useState(false);
  const online = useOnline();
  const add = (list: FileList | null) => list && setFiles((cur) => [...cur, ...Array.from(list)]);
  const submit = async () => {
    setSaving(true);
    try {
      for (const file of files) {
        const fields: Record<string, string> = { category: f.category, phase: f.phase, claimedTakenAt: new Date(file.lastModified || Date.now()).toISOString() };
        for (const k of ['caption', 'location', 'pairKey', 'linkedType', 'linkedId', 'activityId']) if (f[k]) fields[k] = f[k];
        await enqueueUpload(projectId, await shrinkImage(file), fields);
      }
      toast.success(online ? `${files.length} photo(s) queued for upload` : `${files.length} photo(s) saved on this device — they will upload when you are back online`);
      setFiles([]);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };
  const linkSource = LINK_TYPES.find((l) => l.value === f.linkedType)?.source;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Capture site evidence" size="lg" description="Photos are stored unmodified. Upload time and uploader are recorded by the server; device capture time is kept as an unverified claim." footer={<Button loading={saving} disabled={!files.length} icon={<Upload className="h-4 w-4" />} onClick={submit}>Upload {files.length || ''} photo(s)</Button>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <input ref={camera} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => add(e.target.files)} />
          <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => add(e.target.files)} />
          <Button size="lg" icon={<Camera className="h-5 w-5" />} onClick={() => camera.current?.click()}>Take photo</Button>
          <Button size="lg" variant="outline" icon={<ImagePlus className="h-5 w-5" />} onClick={() => picker.current?.click()}>Choose files</Button>
        </div>
        {files.length > 0 && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {files.map((file, i) => (
              <li key={i} className="relative">
                <img src={URL.createObjectURL(file)} alt={file.name} className="aspect-square w-full rounded-lg object-cover" />
                <button className="absolute right-1 top-1 rounded-full bg-white/90 p-1" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5 text-red-600" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" required>
            <Select options={CATEGORIES} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
          </Field>
          <Field label="Location">
            <Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. Tower A L12" />
          </Field>
          <Field label="Caption" className="sm:col-span-2">
            <Input value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} />
          </Field>
          <Field label="Activity">
            <RefSelect source="activities" value={f.activityId || null} onChange={(v) => setF({ ...f, activityId: v ?? '' })} />
          </Field>
          <Field label="Before / after">
            <Select options={[{ value: 'NA', label: 'Not applicable' }, { value: 'BEFORE', label: 'Before' }, { value: 'AFTER', label: 'After' }]} value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })} />
          </Field>
          {f.phase !== 'NA' && (
            <Field label="Comparison key" help="Use the same key for the before and after photos">
              <Input value={f.pairKey} onChange={(e) => setF({ ...f, pairKey: e.target.value.toUpperCase() })} />
            </Field>
          )}
          <Field label="Link to record">
            <Select options={LINK_TYPES.map((l) => ({ value: l.value, label: l.label }))} placeholder="None" value={f.linkedType} onChange={(e) => setF({ ...f, linkedType: e.target.value, linkedId: '' })} />
          </Field>
          {linkSource && (
            <Field label="Record">
              <RefSelect source={linkSource} value={f.linkedId || null} onChange={(v) => setF({ ...f, linkedId: v ?? '' })} />
            </Field>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Viewer({ e, onClose, list }: { e: EvidenceRow; onClose: () => void; list: EvidenceRow[] }) {
  const projectId = useProjectId();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const review = useMutation({
    mutationFn: (status: string) => api.post(`/projects/${projectId}/evidence/${e.id}/review`, { status, comment: comment || undefined }),
    onSuccess: () => { toast.success('Review recorded'); setComment(''); void qc.invalidateQueries({ queryKey: ['p', 'evidence'] }); onClose(); },
    onError: (err: Error) => toast.error(err.message),
  });
  const pair = e.pairKey ? list.filter((x) => x.pairKey === e.pairKey && x.id !== e.id) : [];
  const meta = e.file.clientMeta as Record<string, string | null>;
  const isOwn = e.submittedByName === me?.user.name;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="xl" title={`${e.number} — ${e.caption ?? humanize(e.category)}`} description={`${humanize(e.category)} · ${e.location ?? 'No location'}`}>
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {pair.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {[e, ...pair].sort((a) => (a.phase === 'BEFORE' ? -1 : 1)).map((x) => (
                <figure key={x.id}>
                  <img src={api.url(`/files/${x.file.id}`)} alt={x.caption ?? x.number} className="w-full rounded-lg" />
                  <figcaption className="mt-1 text-center text-xs font-medium">{humanize(x.phase)}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <img src={api.url(`/files/${e.file.id}`)} alt={e.caption ?? e.number} className="w-full rounded-lg" />
          )}
        </div>
        <div className="space-y-4 lg:col-span-2">
          <div className="flex items-center gap-2"><StatusBadge status={e.status} />{e.phase !== 'NA' && <Badge>{humanize(e.phase)}</Badge>}</div>
          <DescriptionList
            columns={2}
            items={[
              { label: 'Uploaded by', value: e.submittedByName },
              { label: 'Uploaded (server time)', value: formatDateTime(e.file.uploadedAt) },
              { label: 'Device capture time (unverified)', value: meta?.claimedTakenAt ? formatDateTime(meta.claimedTakenAt) : null },
              { label: 'Device GPS (unverified)', value: meta?.claimedGps ?? null },
              { label: 'Reviewed by', value: e.verifiedByName },
              { label: 'File', value: `${e.file.originalName} · ${fileSize(e.file.size)}` },
              { label: 'SHA-256', value: <code className="break-all text-[11px]">{e.file.sha256}</code>, span: 2 },
              { label: 'Review comment', value: e.reviewComment, span: 2 },
              { label: 'Linked record', value: e.linkedType ? humanize(e.linkedType) : null },
            ]}
          />
          <p className="rounded-lg bg-slate-50 p-2 text-xs text-muted">A verified photo is supporting evidence only — it does not approve a measurement, expense or invoice.</p>
          {can('evidence.approve') && !isOwn && e.status !== 'VERIFIED' && (
            <div className="space-y-2">
              <Textarea placeholder="Review comment (required to reject or request correction)" value={comment} onChange={(x) => setComment(x.target.value)} aria-label="Review comment" />
              <div className="flex flex-wrap gap-2">
                <Button variant="success" size="sm" icon={<CheckCircle2 className="h-4 w-4" />} loading={review.isPending} onClick={() => review.mutate('VERIFIED')}>Verify</Button>
                <Button variant="outline" size="sm" disabled={!comment.trim()} onClick={() => review.mutate('CORRECTION_REQUIRED')}>Request correction</Button>
                <Button variant="danger" size="sm" icon={<XCircle className="h-4 w-4" />} disabled={!comment.trim()} onClick={() => review.mutate('REJECTED')}>Reject</Button>
              </div>
            </div>
          )}
          {isOwn && e.status !== 'VERIFIED' && <p className="text-xs text-muted">You uploaded this photo, so another reviewer must verify it.</p>}
          <a href={api.url(`/files/${e.file.id}`, { download: 1 })} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
            <Download className="h-4 w-4" /> Download original
          </a>
        </div>
      </div>
    </Dialog>
  );
}

function QueuePanel() {
  const queue = useUploadQueue();
  const online = useOnline();
  const visible = queue.filter((q) => q.status !== 'uploaded');
  if (!visible.length) return <EmptyState title="No pending uploads" description="Photos captured while offline wait here until they reach the server." />;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{online ? 'Online — uploads retry automatically.' : 'Offline — uploads will start when the connection returns.'}</p>
        <Button size="sm" variant="outline" icon={<RefreshCw className="h-4 w-4" />} disabled={!online} onClick={() => void processQueue()}>Retry now</Button>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {visible.map((q) => (
          <li key={q.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium">{q.fileName}</span>
              <span className="text-xs text-muted">{humanize(q.fields.category)} · captured {relativeTime(q.createdAt)}</span>
              {q.error && <span className="block text-xs text-red-600">{q.error}</span>}
            </span>
            <span className="flex items-center gap-2">
              {q.status === 'uploading' ? <Badge tone="info"><Loader2 className="h-3 w-3 animate-spin" /> Uploading</Badge> : q.status === 'failed' ? <Badge tone="danger">Failed</Badge> : <Badge tone="warning"><CloudOff className="h-3 w-3" /> Pending sync</Badge>}
              {q.status !== 'uploading' && <Button size="sm" variant="ghost" aria-label="Discard" onClick={() => removeQueued(q.id)} icon={<Trash2 className="h-4 w-4 text-red-600" />} />}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EvidencePage() {
  const projectId = useProjectId();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') ?? 'gallery');
  const [capture, setCapture] = useState(params.get('capture') === '1');
  const [focus, setFocus] = useState<string | null>(params.get('focus'));
  const [filters, setFilters] = useState({ status: '', category: '', q: '', from: '', to: '', submittedById: '' });
  const [page, setPage] = useState(1);
  const queue = useUploadQueue();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['p', 'evidence', projectId, filters, page, tab], queryFn: () => api.get<Paged<EvidenceRow>>(`/projects/${projectId}/evidence`, { ...filters, status: tab === 'review' ? 'PENDING' : filters.status, page, pageSize: 24 }) });
  const uploaded = queue.filter((q) => q.status === 'uploaded').length;
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['p', 'evidence'] });
  }, [uploaded, qc]);
  useEffect(() => {
    if (params.get('capture') === '1') {
      setCapture(true);
      params.delete('capture');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);
  const focused = list.data?.items.find((e) => e.id === focus);
  const focusedQ = useQuery({ queryKey: ['p', 'evidence', 'one', focus], queryFn: async () => (await api.get<Paged<EvidenceRow>>(`/projects/${projectId}/evidence`, { pageSize: 100 })).items.find((x) => x.id === focus) ?? null, enabled: !!focus && !focused });
  if (!can('evidence.view')) return <Page><PermissionDenied /></Page>;
  const pending = queue.filter((q) => q.status !== 'uploaded').length;
  const viewing = focused ?? focusedQ.data ?? null;

  return (
    <Page>
      <PageHeader title="Site evidence & photos" subtitle="Photo evidence for manpower, measurements, work completion, materials, equipment, quality and safety." actions={can('evidence.manage') && <Button icon={<Camera className="h-4 w-4" />} onClick={() => setCapture(true)}>Capture / upload</Button>} />
      <Card bodyClassName="p-0">
        <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }} tabs={[{ value: 'gallery', label: 'Gallery' }, { value: 'review', label: 'Review queue' }, { value: 'queue', label: 'Upload queue', count: pending || undefined }]} className="px-4 pt-1">
          {['gallery', 'review'].map((t) => (
            <TabPanel key={t} value={t}>
              <div className="flex flex-wrap items-end gap-2 border-b border-line py-3">
                <Input className="w-56" placeholder="Search caption, number, location…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} aria-label="Search evidence" />
                <Select className="w-48" aria-label="Category" options={CATEGORIES} placeholder="All categories" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} />
                {t === 'gallery' && <Select className="w-44" aria-label="Status" options={EVIDENCE_STATUS} placeholder="All statuses" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} />}
                <div className="w-48">
                  <RefSelect source="users" value={filters.submittedById || null} placeholder="Any uploader" onChange={(v) => setFilters({ ...filters, submittedById: v ?? '' })} />
                </div>
                <Input type="date" className="w-36" aria-label="From" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
                <Input type="date" className="w-36" aria-label="To" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
              </div>
              {list.isLoading && <LoadingBlock rows={4} />}
              {list.data?.items.length === 0 && <EmptyState title={t === 'review' ? 'Nothing to review' : 'No photos match'} icon={<Camera className="h-6 w-6" />} />}
              <ul className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {list.data?.items.map((e) => (
                  <li key={e.id}>
                    <button onClick={() => setFocus(e.id)} className={cx('group block w-full overflow-hidden rounded-lg border text-left', e.status === 'REJECTED' ? 'border-red-200' : 'border-line')}>
                      <img src={api.url(`/files/${e.file.id}`)} alt={e.caption ?? e.number} loading="lazy" className="aspect-[4/3] w-full object-cover group-hover:opacity-90" />
                      <div className="p-2">
                        <p className="truncate text-xs font-medium">{e.caption ?? humanize(e.category)}</p>
                        <p className="truncate text-[11px] text-muted">{e.location ?? '—'} · {relativeTime(e.createdAt)}</p>
                        <div className="mt-1 flex items-center justify-between gap-1">
                          <StatusBadge status={e.status} />
                          {e.phase !== 'NA' && <Badge>{humanize(e.phase)}</Badge>}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
            </TabPanel>
          ))}
          <TabPanel value="queue" className="py-4">
            <QueuePanel />
          </TabPanel>
        </Tabs>
      </Card>
      {capture && <CaptureDialog open={capture} onOpenChange={setCapture} />}
      {viewing && <Viewer e={viewing} list={list.data?.items ?? []} onClose={() => { setFocus(null); if (params.get('focus')) { params.delete('focus'); setParams(params, { replace: true }); } }} />}
    </Page>
  );
}
