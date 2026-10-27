import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, CircleDot, CornerUpLeft, FileUp, Paperclip, Send, XCircle, AlertTriangle, Clock } from 'lucide-react';
import { api, type Paged } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { fileSize, formatDateTime, formatMoney, humanize, relativeTime } from '../../lib/format';
import { Badge, Button, EmptyState, ErrorState, LoadingBlock, StatusBadge, Textarea, cx } from '../ui';
import { RefSelect } from '../forms/RefSelect';

interface ApprovalAction {
  id: string;
  stepNo: number;
  action: string;
  actorName: string;
  onBehalfOfName: string | null;
  comment: string | null;
  createdAt: string;
}
interface ApprovalHistory {
  id: string;
  status: string;
  amount: string | null;
  submittedAt: string;
  completedAt: string | null;
  submittedBy: string;
  currentStepNo: number;
  steps: Array<{ stepNo: number; name: string; approverRoleCode: string | null; slaHours: number }>;
  actions: ApprovalAction[];
}

const ACTION_ICON: Record<string, JSX.Element> = {
  SUBMIT: <Send className="h-4 w-4 text-sky-600" />,
  RESUBMIT: <Send className="h-4 w-4 text-sky-600" />,
  APPROVE: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  REJECT: <XCircle className="h-4 w-4 text-red-600" />,
  RETURN: <CornerUpLeft className="h-4 w-4 text-amber-600" />,
  ESCALATE: <AlertTriangle className="h-4 w-4 text-red-500" />,
  CANCEL: <XCircle className="h-4 w-4 text-slate-500" />,
};

/** Workflow history with inline approve / return / reject for eligible approvers. */
export function ApprovalTimeline({ docType, entityId, onChanged }: { docType: string; entityId: string; onChanged?: () => void }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const hist = useQuery({ queryKey: ['p', 'approval-history', docType, entityId], queryFn: () => api.get<ApprovalHistory[]>('/approvals/history', { docType, entityId }) });
  const pending = hist.data?.find((h) => h.status === 'PENDING');
  const detail = useQuery({ queryKey: ['p', 'approval', pending?.id], queryFn: () => api.get<{ canAct: boolean; submittedById: string; id: string }>(`/approvals/${pending!.id}`), enabled: !!pending });
  const [comment, setComment] = useState('');
  const act = useMutation({
    mutationFn: ({ action }: { action: 'approve' | 'reject' | 'return' | 'withdraw' }) => api.post(`/approvals/${pending!.id}/${action}`, { comment: comment || undefined }),
    onSuccess: (_d, v) => {
      toast.success(v.action === 'approve' ? 'Approved' : v.action === 'withdraw' ? 'Withdrawn' : v.action === 'return' ? 'Returned for correction' : 'Rejected');
      setComment('');
      void qc.invalidateQueries({ queryKey: ['p'] });
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      onChanged?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (hist.isLoading) return <LoadingBlock rows={2} />;
  if (hist.error) return <ErrorState error={hist.error} onRetry={() => hist.refetch()} />;
  if (!hist.data?.length) return <EmptyState title="Not submitted for approval yet" description="Submitting sends this document through the configured approval workflow." />;
  return (
    <div className="space-y-5">
      {pending && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Clock className="h-4 w-4 text-amber-700" />
            <span className="text-sm font-medium text-amber-900">Awaiting: {pending.steps.find((s) => s.stepNo === pending.currentStepNo)?.name}</span>
            {pending.amount && <Badge tone="neutral">{formatMoney(pending.amount)}</Badge>}
          </div>
          <ol className="mb-3 flex flex-wrap gap-2">
            {pending.steps.map((s) => (
              <li key={s.stepNo} className={cx('rounded-md px-2 py-1 text-xs', s.stepNo < pending.currentStepNo ? 'bg-emerald-100 text-emerald-800' : s.stepNo === pending.currentStepNo ? 'bg-amber-200 text-amber-900' : 'bg-white text-muted ring-1 ring-line')}>
                {s.stepNo}. {s.name}
              </li>
            ))}
          </ol>
          {detail.data?.canAct && (
            <div className="space-y-2">
              <Textarea placeholder="Comment (required to return or reject)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Approval comment" />
              <div className="flex flex-wrap gap-2">
                <Button variant="success" size="sm" loading={act.isPending && act.variables?.action === 'approve'} onClick={() => act.mutate({ action: 'approve' })}>
                  Approve
                </Button>
                <Button variant="outline" size="sm" disabled={!comment.trim()} onClick={() => act.mutate({ action: 'return' })}>
                  Return for correction
                </Button>
                <Button variant="danger" size="sm" disabled={!comment.trim()} onClick={() => act.mutate({ action: 'reject' })}>
                  Reject
                </Button>
              </div>
            </div>
          )}
          {detail.data && !detail.data.canAct && detail.data.submittedById === me?.user.id && (
            <Button variant="outline" size="sm" onClick={() => act.mutate({ action: 'withdraw' })}>
              Withdraw submission
            </Button>
          )}
        </div>
      )}
      {[...hist.data].reverse().map((h) => (
        <div key={h.id}>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted">
            <StatusBadge status={h.status} />
            <span>
              Submitted by {h.submittedBy} · {formatDateTime(h.submittedAt)}
            </span>
          </div>
          <ol className="relative ml-2 space-y-3 border-l border-line pl-5">
            {h.actions.map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[29px] top-0.5 rounded-full bg-white p-0.5">{ACTION_ICON[a.action] ?? <CircleDot className="h-4 w-4 text-slate-400" />}</span>
                <p className="text-sm text-ink">
                  <span className="font-medium">{a.actorName}</span> {humanize(a.action).toLowerCase()}
                  {a.stepNo > 0 && <span className="text-muted"> · {h.steps.find((s) => s.stepNo === a.stepNo)?.name ?? `step ${a.stepNo}`}</span>}
                  {a.onBehalfOfName && <span className="text-muted"> (on behalf of {a.onBehalfOfName})</span>}
                </p>
                {a.comment && <p className="mt-0.5 rounded bg-slate-50 px-2 py-1 text-sm text-ink">“{a.comment}”</p>}
                <p className="text-xs text-muted">{formatDateTime(a.createdAt)}</p>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

interface CommentRow {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  mentions: string[];
}

export function CommentsPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['p', 'comments', entityType, entityId], queryFn: () => api.get<CommentRow[]>(`/projects/${projectId}/comments`, { entityType, entityId }) });
  const [body, setBody] = useState('');
  const [mention, setMention] = useState<string | null>(null);
  const [mentions, setMentions] = useState<Array<{ id: string; name: string }>>([]);
  const post = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/comments`, { entityType, entityId, body, mentions: mentions.map((m) => m.id), link: window.location.pathname }),
    onSuccess: () => {
      setBody('');
      setMentions([]);
      void qc.invalidateQueries({ queryKey: ['p', 'comments', entityType, entityId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      {q.isLoading && <LoadingBlock rows={2} />}
      {q.data?.length === 0 && <p className="text-sm text-muted">No comments yet.</p>}
      <ul className="space-y-3">
        {q.data?.map((c) => (
          <li key={c.id} className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-xs text-muted">
              <span className="font-medium text-ink">{c.authorName}</span> · {relativeTime(c.createdAt)}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{c.body}</p>
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment…" aria-label="New comment" />
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-56">
            <RefSelect
              source="users"
              value={mention}
              placeholder="@ Mention a colleague"
              onChange={(v, o) => {
                if (v && o && !mentions.some((m) => m.id === v)) setMentions([...mentions, { id: v, name: o.label }]);
                setMention(null);
              }}
            />
          </div>
          {mentions.map((m) => (
            <Badge key={m.id} tone="primary">
              @{m.name}
              <button aria-label={`Remove ${m.name}`} onClick={() => setMentions(mentions.filter((x) => x.id !== m.id))}>
                ×
              </button>
            </Badge>
          ))}
          <Button size="sm" className="ml-auto" disabled={!body.trim()} loading={post.isPending} onClick={() => post.mutate()}>
            Post comment
          </Button>
        </div>
      </div>
    </div>
  );
}

interface AttachmentRow {
  id: string;
  label: string | null;
  uploadedByName: string;
  createdAt: string;
  file: { id: string; originalName: string; mimeType: string; size: number; sha256: string };
}

export function AttachmentsPanel({ entityType, entityId, canUpload = true }: { entityType: string; entityId: string; canUpload?: boolean }) {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['p', 'attachments', entityType, entityId], queryFn: () => api.get<AttachmentRow[]>(`/projects/${projectId}/attachments`, { entityType, entityId }) });
  const up = useMutation({
    mutationFn: (files: FileList) => {
      const f = new FormData();
      f.append('entityType', entityType);
      f.append('entityId', entityId);
      Array.from(files).forEach((x) => f.append('files', x));
      return api.upload(`/projects/${projectId}/attachments`, f);
    },
    onSuccess: () => {
      toast.success('Attachment uploaded');
      void qc.invalidateQueries({ queryKey: ['p', 'attachments', entityType, entityId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      {q.isLoading && <LoadingBlock rows={2} />}
      {q.data?.length === 0 && <p className="text-sm text-muted">No attachments.</p>}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {q.data?.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Paperclip className="h-4 w-4 shrink-0 text-muted" />
              <a href={api.url(`/files/${a.file.id}`)} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-brand-600 hover:underline">
                {a.label ?? a.file.originalName}
              </a>
            </div>
            <span className="shrink-0 text-xs text-muted">
              {fileSize(a.file.size)} · {a.uploadedByName} · {relativeTime(a.createdAt)}
            </span>
          </li>
        ))}
      </ul>
      {canUpload && (
        <>
          <input ref={input} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx,.csv" onChange={(e) => e.target.files?.length && up.mutate(e.target.files)} />
          <Button variant="outline" size="sm" icon={<FileUp className="h-4 w-4" />} loading={up.isPending} onClick={() => input.current?.click()}>
            Upload attachment
          </Button>
          <p className="text-xs text-muted">PDF, images, Excel, Word or CSV. Files are checked by content type and stored unmodified with a SHA-256 fingerprint.</p>
        </>
      )}
    </div>
  );
}

interface AuditRow {
  id: string;
  action: string;
  summary: string | null;
  actorName: string;
  createdAt: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export function AuditTimeline({ entityType, entityId }: { entityType: string; entityId: string }) {
  const q = useQuery({ queryKey: ['p', 'audit', entityType, entityId], queryFn: () => api.get<AuditRow[]>('/admin/audit/entity', { entityType, entityId }) });
  if (q.isLoading) return <LoadingBlock rows={3} />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data?.length) return <p className="text-sm text-muted">No history recorded.</p>;
  return (
    <ol className="space-y-3">
      {q.data.map((a) => (
        <li key={a.id} className="rounded-lg border border-line px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="primary">{humanize(a.action)}</Badge>
            <span className="font-medium text-ink">{a.actorName}</span>
            <span>{formatDateTime(a.createdAt)}</span>
          </div>
          {a.summary && <p className="mt-1 text-sm text-ink">{a.summary}</p>}
          {a.reason && <p className="mt-1 text-sm text-muted">Reason: {a.reason}</p>}
          {a.after && a.before && Object.keys(a.after).length > 0 && (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer text-brand-600">Changed fields ({Object.keys(a.after).length})</summary>
              <table className="mt-1 w-full text-left">
                <tbody>
                  {Object.keys(a.after).map((k) => (
                    <tr key={k} className="border-t border-line">
                      <td className="py-1 pr-2 font-medium text-muted">{k}</td>
                      <td className="py-1 pr-2 text-red-700 line-through">{JSON.stringify(a.before?.[k] ?? null)}</td>
                      <td className="py-1 text-emerald-700">{JSON.stringify(a.after?.[k] ?? null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}

export interface EvidenceRow {
  id: string;
  number: string;
  category: string;
  caption: string | null;
  location: string | null;
  status: string;
  phase: string;
  pairKey: string | null;
  createdAt: string;
  claimedTakenAt: string | null;
  submittedByName: string | null;
  verifiedByName: string | null;
  reviewComment: string | null;
  linkedType: string | null;
  linkedId: string | null;
  file: { id: string; originalName: string; mimeType: string; size: number; sha256: string; uploadedAt: string; clientMeta: Record<string, unknown> };
}

export function LinkedEvidence({ linkedType, linkedId }: { linkedType: string; linkedId: string }) {
  const projectId = useProjectId();
  const q = useQuery({ queryKey: ['p', 'evidence', 'linked', linkedType, linkedId], queryFn: () => api.get<Paged<EvidenceRow>>(`/projects/${projectId}/evidence`, { linkedType, linkedId, pageSize: 50 }) });
  if (q.isLoading) return <LoadingBlock rows={1} />;
  if (!q.data?.items.length) return <p className="text-sm text-muted">No photo evidence linked. Upload from Site Evidence and link it to this record. A verified photo does not approve this record.</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {q.data.items.map((e) => (
        <li key={e.id} className="overflow-hidden rounded-lg border border-line">
          <a href={api.url(`/files/${e.file.id}`)} target="_blank" rel="noreferrer">
            <img src={api.url(`/files/${e.file.id}`)} alt={e.caption ?? e.number} className="aspect-[4/3] w-full object-cover" loading="lazy" />
          </a>
          <div className="p-2">
            <p className="truncate text-xs font-medium">{e.caption ?? e.number}</p>
            <StatusBadge status={e.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}
