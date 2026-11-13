import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Ban, CheckCircle2, Info, Paperclip } from 'lucide-react';
import { api } from '../../lib/api';
import { useProjectId } from '../../lib/auth';
import { formatQty } from '../../lib/format';
import { Badge, LoadingBlock, cx } from '../ui';

/** Purchase match check (MR / PR / PO): each line against the BOM, its MR / PR, the awarded quotation and the budget. */
export type MatchStatus = 'MATCH' | 'DIFF' | 'BLOCKED';
type CheckStatus = 'ok' | 'diff' | 'block' | 'info';
interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  actual?: string;
  expected?: string;
  diffPct?: string;
  note: string;
}
export interface MatchResult {
  docType: 'MR' | 'PR' | 'PO';
  number: string;
  mode: 'ENFORCE' | 'WARN';
  tolerances: { ratePct: string; qtyPct: string };
  status: MatchStatus;
  summary: string;
  lines: Array<{ lineNo: number; material: { code: string; name: string; unit: string } | null; description: string; qty: string; unit: string; rate: string | null; status: CheckStatus; checks: Check[] }>;
  documentChecks: Check[];
  counts: { ok: number; diff: number; block: number };
  attachments: number;
  approval: { allowed: boolean; needsReason: boolean; needsAttachment: boolean; message: string };
}

export const MATCH_DOC_TYPES = ['MR', 'PR', 'PO'];

export function useMatchCheck(docType: string, entityId: string | undefined, enabled = true) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: ['p', 'match-check', docType, entityId],
    queryFn: () => api.get<MatchResult>(`/projects/${projectId}/procurement/match-check/${docType}/${entityId}`),
    enabled: enabled && !!entityId && MATCH_DOC_TYPES.includes(docType),
  });
}

const pctText = (f: string) => `${Math.round(Number(f) * 1000) / 10}%`;

/** Small badge for lists (approval inbox). */
export function MatchBadge({ status, mode }: { status: MatchStatus; mode?: string }) {
  if (status === 'MATCH')
    return (
      <Badge tone="success">
        <CheckCircle2 className="h-3 w-3" />
        All match
      </Badge>
    );
  if (status === 'BLOCKED')
    return (
      <Badge tone={mode === 'WARN' ? 'warning' : 'danger'}>
        <Ban className="h-3 w-3" />
        Not in BOM
      </Badge>
    );
  return (
    <Badge tone="warning">
      <AlertTriangle className="h-3 w-3" />
      Differences
    </Badge>
  );
}

/**
 * Why the approve button is not available yet, or null when the approver can approve.
 * Mirrors the server rule (the server enforces it regardless).
 */
export function approveBlockedReason(m: MatchResult | null | undefined, comment: string): string | null {
  if (!m || m.mode === 'WARN' || m.status === 'MATCH') return null;
  if (!m.approval.allowed) return m.approval.message;
  const missing = [m.approval.needsReason && comment.trim().length < 5 ? 'a reason (at least 5 characters)' : null, m.approval.needsAttachment ? 'a supporting document in the Attachments tab' : null].filter(Boolean);
  return missing.length ? `To approve, add ${missing.join(' and ')}.` : null;
}

const ICON: Record<CheckStatus, ReactNode> = {
  ok: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />,
  diff: <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />,
  block: <Ban className="h-3.5 w-3.5 text-red-600" />,
  info: <Info className="h-3.5 w-3.5 text-sky-600" />,
};

/** The full check: summary strip, the rule that applies, and every line with its checks. */
export function MatchCheckView({ m, compact = false }: { m: MatchResult; compact?: boolean }) {
  const tone = m.status === 'MATCH' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : m.status === 'BLOCKED' && m.mode === 'ENFORCE' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900';
  const shown = compact ? m.lines.filter((l) => l.status !== 'ok') : m.lines;
  return (
    <div className="space-y-3">
      <div className={cx('rounded-lg border px-3 py-2 text-sm', tone)}>
        <p className="flex items-center gap-2 font-medium">
          {m.status === 'MATCH' ? <CheckCircle2 className="h-4 w-4" /> : m.status === 'BLOCKED' ? <Ban className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          Match check: {m.summary}
        </p>
        <p className="mt-0.5 text-xs opacity-90">
          {m.approval.message} Tolerance: rate {pctText(m.tolerances.ratePct)}, quantity {pctText(m.tolerances.qtyPct)}.
          {m.status === 'DIFF' && m.mode === 'ENFORCE' && (
            <span className="ml-1 inline-flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              {m.attachments} attachment{m.attachments === 1 ? '' : 's'}
            </span>
          )}
        </p>
      </div>
      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Material</th>
                <th className="py-1 pr-2 text-right">Qty</th>
                <th className="py-1 pr-2 text-right">Rate</th>
                <th className="py-1">Checks</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.lineNo} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2 text-muted">{l.lineNo}</td>
                  <td className="py-1.5 pr-2">
                    <span className="font-medium text-navy-800">{l.material?.code ?? '—'}</span>
                    <span className="block text-xs text-muted">{l.material?.name ?? l.description}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">
                    {formatQty(l.qty)} {l.unit}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{l.rate ?? '—'}</td>
                  <td className="py-1.5">
                    <ul className="space-y-0.5">
                      {l.checks
                        .filter((c) => !compact || c.status !== 'ok')
                        .map((c) => (
                          <li key={c.key} className="flex gap-1.5 text-xs">
                            <span className="mt-0.5 shrink-0">{ICON[c.status]}</span>
                            <span>
                              <span className="font-medium">{c.label}:</span> {c.note}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {m.documentChecks.length > 0 && (
        <ul className="space-y-0.5">
          {m.documentChecks.map((c) => (
            <li key={c.key} className="flex gap-1.5 text-xs">
              <span className="mt-0.5 shrink-0">{ICON[c.status]}</span>
              <span>
                <span className="font-medium">{c.label}:</span> {c.note}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Banner on the MR / PR / PO page. */
export function MatchCheckBanner({ docType, entityId }: { docType: string; entityId: string }) {
  const q = useMatchCheck(docType, entityId);
  if (q.isLoading) return <LoadingBlock rows={1} />;
  if (!q.data) return null;
  return (
    <div className="mb-4">
      <MatchCheckView m={q.data} />
    </div>
  );
}
