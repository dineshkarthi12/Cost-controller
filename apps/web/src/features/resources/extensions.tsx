/* eslint-disable react-refresh/only-export-components */
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileDown, FileUp, Handshake, PackageCheck, Receipt, Scale, ShieldCheck, ShoppingCart, Upload, Users, XCircle } from 'lucide-react';
import { humanize, TASK_STATUS_LABEL } from '@toprock/shared';
import { api } from '../../lib/api';
import { formatDate, formatDateTime, formatMoney, formatQty, todayIso } from '../../lib/format';
import { Badge, Button, ConfirmDialog, DescriptionList, Dialog, Field, Input, StatusBadge, Textarea, LoadingBlock, cx } from '../../components/ui';
import { RefSelect } from '../../components/forms/RefSelect';
import type { ExtensionContext, Rec } from './ResourceViews';

export interface Extension {
  actions?: (ctx: ExtensionContext) => ReactNode;
  panels?: (ctx: ExtensionContext) => Array<{ value: string; label: string; render: () => ReactNode }>;
  banner?: (ctx: ExtensionContext) => ReactNode;
}

function useAction(ctx: ExtensionContext, fn: (body?: unknown) => Promise<unknown>, success: string, after?: (r: unknown) => void) {
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      toast.success(success);
      ctx.refetch();
      after?.(r);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  const cls = { info: 'border-sky-200 bg-sky-50 text-sky-900', warning: 'border-amber-200 bg-amber-50 text-amber-900', danger: 'border-red-200 bg-red-50 text-red-800', success: 'border-emerald-200 bg-emerald-50 text-emerald-900' }[tone];
  return <div className={cx('mb-4 flex gap-2 rounded-lg border px-3 py-2 text-sm', cls)}>{children}</div>;
}

// ───────── Procurement ─────────

function MrActions({ ctx }: { ctx: ExtensionContext }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [cc, setCc] = useState<string | null>((ctx.record.costCodeId as string) ?? null);
  const m = useAction(ctx, () => api.post<Rec>(`/projects/${ctx.projectId}/procurement/pr-from-mr/${ctx.record.id}`, { costCodeId: cc }), 'Purchase requisition drafted', (r) => navigate(`/procurement/pr/${(r as Rec).id}`));
  if (ctx.record.status !== 'APPROVED' || !ctx.can('procurement.manage')) return null;
  return (
    <>
      <Button icon={<ShoppingCart className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Create PR
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Create purchase requisition" description="Lines are copied from the MR with the material standard rate as the estimate." footer={<Button loading={m.isPending} disabled={!cc} onClick={() => m.mutate(undefined)}>Create PR draft</Button>}>
        <Field label="Cost code to charge" required>
          <RefSelect source="costCodes" value={cc} onChange={setCc} />
        </Field>
      </Dialog>
    </>
  );
}

function BudgetCheckPanel({ record }: { record: Rec }) {
  const bc = record.budgetCheck as { exceeded: boolean; lines: Array<{ costCode: string; available: string; requested: string; after: string; exceeded: boolean }> } | null;
  if (!bc) return <p className="text-sm text-muted">The budget check runs when the document is submitted.</p>;
  return (
    <div>
      <Notice tone={bc.exceeded ? 'warning' : 'success'}>{bc.exceeded ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{bc.exceeded ? 'One or more cost codes exceed the remaining budget.' : 'Within remaining budget for all cost codes.'}</Notice>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-1">Cost code</th>
            <th className="py-1 text-right">Remaining before</th>
            <th className="py-1 text-right">This document</th>
            <th className="py-1 text-right">Remaining after</th>
          </tr>
        </thead>
        <tbody>
          {bc.lines.map((l) => (
            <tr key={l.costCode} className="border-t border-line">
              <td className="py-1.5">{l.costCode}</td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(l.available)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(l.requested)}</td>
              <td className={cx('py-1.5 text-right tabular-nums', l.exceeded && 'font-semibold text-red-600')}>{formatMoney(l.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrActions({ ctx }: { ctx: ExtensionContext }) {
  const navigate = useNavigate();
  const [po, setPo] = useState(false);
  const [rfq, setRfq] = useState(false);
  const [supplier, setSupplier] = useState<string | null>(null);
  const [rfqForm, setRfqForm] = useState<{ title: string; dueDate: string; suppliers: Array<{ id: string; name: string }> }>({ title: `Quotation for ${ctx.record.number}`, dueDate: todayIso(), suppliers: [] });
  const mPo = useAction(ctx, () => api.post<Rec>(`/projects/${ctx.projectId}/procurement/po-from-pr/${ctx.record.id}`, { supplierId: supplier }), 'Purchase order drafted', (r) => navigate(`/procurement/po/${(r as Rec).id}`));
  const mRfq = useAction(ctx, () => api.post<Rec>(`/projects/${ctx.projectId}/procurement/rfqs`, { prId: ctx.record.id, title: rfqForm.title, dueDate: rfqForm.dueDate, supplierIds: rfqForm.suppliers.map((s) => s.id) }), 'RFQ issued', (r) => navigate(`/procurement/rfq/${(r as Rec).id}`));
  if (ctx.record.status !== 'APPROVED' || !ctx.can('procurement.manage')) return null;
  return (
    <>
      <Button variant="outline" icon={<Scale className="h-4 w-4" />} onClick={() => setRfq(true)}>
        Raise RFQ
      </Button>
      <Button icon={<ShoppingCart className="h-4 w-4" />} onClick={() => setPo(true)}>
        Create PO
      </Button>
      <Dialog open={po} onOpenChange={setPo} title="Create purchase order" footer={<Button loading={mPo.isPending} disabled={!supplier} onClick={() => mPo.mutate(undefined)}>Create PO draft</Button>}>
        <Field label="Supplier" required>
          <RefSelect source="suppliers" value={supplier} onChange={setSupplier} />
        </Field>
      </Dialog>
      <Dialog open={rfq} onOpenChange={setRfq} title="Request for quotation" footer={<Button loading={mRfq.isPending} disabled={!rfqForm.suppliers.length} onClick={() => mRfq.mutate(undefined)}>Issue RFQ</Button>}>
        <div className="space-y-3">
          <Field label="Title" required>
            <Input value={rfqForm.title} onChange={(e) => setRfqForm({ ...rfqForm, title: e.target.value })} />
          </Field>
          <Field label="Quotations due" required>
            <Input type="date" value={rfqForm.dueDate} onChange={(e) => setRfqForm({ ...rfqForm, dueDate: e.target.value })} />
          </Field>
          <Field label="Invite suppliers" required>
            <RefSelect source="suppliers" value={null} placeholder="Add supplier…" onChange={(v, o) => v && o && !rfqForm.suppliers.some((s) => s.id === v) && setRfqForm({ ...rfqForm, suppliers: [...rfqForm.suppliers, { id: v, name: o.label }] })} />
          </Field>
          <div className="flex flex-wrap gap-1">
            {rfqForm.suppliers.map((s) => (
              <Badge key={s.id} tone="primary">
                {s.name}
                <button aria-label={`Remove ${s.name}`} onClick={() => setRfqForm({ ...rfqForm, suppliers: rfqForm.suppliers.filter((x) => x.id !== s.id) })}>
                  ×
                </button>
              </Badge>
            ))}
          </div>
        </div>
      </Dialog>
    </>
  );
}

interface Recon {
  lines: Array<{ lineNo: number; description: string; unit: string; orderedQty: string; receivedQty: string; invoicedQty: string; pendingDeliveryQty: string; uninvoicedReceivedQty: string; orderedValue: string; receivedValue: string }>;
  grns: Array<{ id: string; number: string; status: string; receivedDate: string; acceptedValue: string }>;
  invoices: Array<{ id: string; number: string; invoiceNo: string; status: string; subtotal: string; total: string; paidAmount: string }>;
  totals: Record<string, string>;
}

function PoReconciliation({ ctx }: { ctx: ExtensionContext }) {
  const q = useQuery({ queryKey: ['p', 'po-recon', ctx.record.id], queryFn: () => api.get<Recon>(`/projects/${ctx.projectId}/procurement/po/${ctx.record.id}/reconciliation`) });
  const navigate = useNavigate();
  if (q.isLoading || !q.data) return <LoadingBlock rows={3} />;
  const t = q.data.totals;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['Ordered (net)', t.ordered],
          ['Received value', t.received],
          ['Invoiced (net)', t.invoiced],
          ['Paid', t.paid],
          ['Open commitment', t.openCommitment],
        ].map(([l, v]) => (
          <div key={l} className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-muted">{l}</p>
            <p className="text-sm font-semibold tabular-nums">{formatMoney(v)}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="text-left">
              <th className="py-1">Line</th>
              <th>Description</th>
              <th className="text-right">Ordered</th>
              <th className="text-right">Received</th>
              <th className="text-right">Invoiced</th>
              <th className="text-right">To receive</th>
              <th className="text-right">Received, not invoiced</th>
            </tr>
          </thead>
          <tbody>
            {q.data.lines.map((l) => (
              <tr key={l.lineNo} className="border-t border-line">
                <td className="py-1.5">{l.lineNo}</td>
                <td>{l.description}</td>
                <td className="text-right tabular-nums">{formatQty(l.orderedQty)} {l.unit}</td>
                <td className="text-right tabular-nums">{formatQty(l.receivedQty)}</td>
                <td className="text-right tabular-nums">{formatQty(l.invoicedQty)}</td>
                <td className="text-right tabular-nums">{formatQty(l.pendingDeliveryQty)}</td>
                <td className={cx('text-right tabular-nums', Number(l.uninvoicedReceivedQty) < 0 && 'font-semibold text-red-600')}>{formatQty(l.uninvoicedReceivedQty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase text-muted">Goods receipts</h4>
          {q.data.grns.length === 0 && <p className="text-sm text-muted">None yet.</p>}
          {q.data.grns.map((g) => (
            <button key={g.id} onClick={() => navigate(`/procurement/grn/${g.id}`)} className="flex w-full items-center justify-between border-t border-line py-1.5 text-left text-sm hover:bg-slate-50">
              <span>
                {g.number} · {formatDate(g.receivedDate)}
              </span>
              <span className="flex items-center gap-2">
                {formatMoney(g.acceptedValue)} <StatusBadge status={g.status} />
              </span>
            </button>
          ))}
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase text-muted">Supplier invoices</h4>
          {q.data.invoices.length === 0 && <p className="text-sm text-muted">None yet.</p>}
          {q.data.invoices.map((i) => (
            <button key={i.id} onClick={() => navigate(`/payables/invoices/${i.id}`)} className="flex w-full items-center justify-between border-t border-line py-1.5 text-left text-sm hover:bg-slate-50">
              <span>
                {i.number} · {i.invoiceNo}
              </span>
              <span className="flex items-center gap-2">
                {formatMoney(i.total)} <StatusBadge status={i.status} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface PoLine {
  id: string;
  lineNo: number;
  materialId: string | null;
  description: string;
  qty: string;
  unit: string;
  rate: string;
  discountPct: string;
  taxRate: string;
  costCodeId: string;
  receivedQty: string;
  invoicedQty: string;
}

function PoAmendDialog({ ctx, open, onOpenChange }: { ctx: ExtensionContext; open: boolean; onOpenChange: (o: boolean) => void }) {
  const lines = (ctx.record.lines as PoLine[]) ?? [];
  const [rows, setRows] = useState(lines.map((l) => ({ id: l.id, materialId: l.materialId, description: l.description, qty: String(l.qty), unit: l.unit, rate: String(l.rate), discountPct: String(l.discountPct), taxRate: String(l.taxRate), costCodeId: l.costCodeId, min: Math.max(Number(l.receivedQty), Number(l.invoicedQty)) })));
  const [reason, setReason] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(String(ctx.record.deliveryDate ?? '').slice(0, 10));
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async () => {
      const rev = await api.post<Rec>(`/projects/${ctx.projectId}/procurement/po/${ctx.record.id}/amend`, { reason, deliveryDate: deliveryDate || undefined, lines: rows.map(({ min: _m, ...r }) => r) });
      await api.post(`/projects/${ctx.projectId}/procurement/po-amendments/${rev.id}/submit`);
    },
    onSuccess: () => {
      toast.success('Amendment submitted for approval');
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ['p'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={`Amend ${ctx.record.number}`} description="Quantities cannot go below what has been received or invoiced. The approved amendment adjusts the commitment by the difference." footer={<Button loading={m.isPending} disabled={reason.trim().length < 5} onClick={() => m.mutate()}>Submit amendment</Button>}>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.id} className="grid grid-cols-2 gap-2 rounded-lg border border-line p-2 sm:grid-cols-4">
            <p className="col-span-2 text-sm font-medium sm:col-span-4">
              {i + 1}. {r.description} <span className="text-xs text-muted">(received/invoiced {r.min} {r.unit})</span>
            </p>
            <Field label="Qty">
              <Input inputMode="decimal" value={r.qty} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
            </Field>
            <Field label="Rate">
              <Input inputMode="decimal" value={r.rate} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
            </Field>
          </div>
        ))}
        <Field label="New delivery date">
          <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
        </Field>
        <Field label="Reason for amendment" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function PoActions({ ctx }: { ctx: ExtensionContext }) {
  const navigate = useNavigate();
  const [amend, setAmend] = useState(false);
  const [close, setClose] = useState(false);
  const status = String(ctx.record.status);
  const open = ['APPROVED', 'PARTIALLY_RECEIVED'].includes(status);
  const m = useAction(ctx, (body) => api.post(`/projects/${ctx.projectId}/procurement/po/${ctx.record.id}/close`, body), 'Purchase order closed; open commitment released');
  return (
    <>
      <Button variant="outline" icon={<FileDown className="h-4 w-4" />} onClick={() => window.open(api.url(`/projects/${ctx.projectId}/procurement/po/${ctx.record.id}/pdf`), '_blank')}>
        PDF
      </Button>
      {open && ctx.can('receiving.manage') && (
        <Button icon={<PackageCheck className="h-4 w-4" />} onClick={() => navigate(`/procurement/grn/new?poId=${ctx.record.id}`)}>
          Record GRN
        </Button>
      )}
      {['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(status) && ctx.can('payable.manage') && (
        <Button variant="outline" icon={<Receipt className="h-4 w-4" />} onClick={() => navigate(`/payables/invoices/new?poId=${ctx.record.id}`)}>
          Record invoice
        </Button>
      )}
      {open && ctx.can('procurement.manage') && (
        <Button variant="outline" onClick={() => setAmend(true)}>
          Amend
        </Button>
      )}
      {['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(status) && ctx.can('procurement.approve') && (
        <Button variant="ghost" className="text-red-600" onClick={() => setClose(true)}>
          Close / cancel
        </Button>
      )}
      {amend && <PoAmendDialog ctx={ctx} open={amend} onOpenChange={setAmend} />}
      <ConfirmDialog open={close} onOpenChange={setClose} title="Close this purchase order?" message="Remaining open commitment is released from the cost forecast. If nothing has been received or invoiced the PO is cancelled; otherwise it is short-closed." requireReason tone="danger" confirmLabel="Close PO" loading={m.isPending} onConfirm={(reason) => m.mutate({ reason })} />
    </>
  );
}

function PoRevisions({ ctx }: { ctx: ExtensionContext }) {
  const revs = (ctx.record.revisions as Array<{ id: string; number: string; revisionNo: number; reason: string; status: string; createdAt: string; approvedAt: string | null; proposed: { netAmount: string } }>) ?? [];
  if (!revs.length) return <p className="text-sm text-muted">No amendments.</p>;
  return (
    <ul className="space-y-2">
      {revs.map((r) => (
        <li key={r.id} className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {r.number} — revision {r.revisionNo}
            </span>
            <span className="flex items-center gap-2 text-sm">
              New net {formatMoney(r.proposed.netAmount)} <StatusBadge status={r.status} />
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">{r.reason}</p>
          <p className="text-xs text-muted">
            Raised {formatDateTime(r.createdAt)}
            {r.approvedAt && ` · approved ${formatDateTime(r.approvedAt)}`}
          </p>
        </li>
      ))}
    </ul>
  );
}

function InvoiceMatch({ record }: { record: Rec }) {
  const m = record.matchResult as { matched: boolean; unlinkedLines: number; lines: Array<{ lineRef: string; ok: boolean; invoiceableQty: string; qtyVariance: string; rateVariancePct: string | null; issues: string[] }> } | null;
  if (!record.poId) return <p className="text-sm text-muted">Non-PO invoice — no three-way match applies. Cost is recognised on approval.</p>;
  if (!m) return <p className="text-sm text-muted">The three-way match (PO ↔ GRN ↔ invoice) runs when the invoice is submitted.</p>;
  return (
    <div>
      <Notice tone={m.matched && !m.unlinkedLines ? 'success' : 'warning'}>
        {m.matched && !m.unlinkedLines ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        {m.matched && !m.unlinkedLines ? 'Matched: quantities are within received quantities and rates within tolerance.' : 'Exception: approvers must review the issues below before approving.'}
      </Notice>
      <ul className="space-y-2">
        {m.lines.map((l) => (
          <li key={l.lineRef} className="rounded-lg border border-line p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              {l.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
              {l.lineRef}
            </div>
            <p className="mt-1 text-muted">
              Invoiceable qty {formatQty(l.invoiceableQty)} · rate variance {l.rateVariancePct ? `${(Number(l.rateVariancePct) * 100).toFixed(2)}%` : '—'}
            </p>
            {l.issues.map((i) => (
              <p key={i} className="text-red-700">
                • {i}
              </p>
            ))}
          </li>
        ))}
        {m.unlinkedLines > 0 && <li className="text-sm text-amber-800">{m.unlinkedLines} line(s) are not linked to a PO line.</li>}
      </ul>
    </div>
  );
}

// ───────── Measurements ─────────

function MeasurementActions({ ctx }: { ctx: ExtensionContext }) {
  const r = ctx.record;
  const [verify, setVerify] = useState(false);
  const [ret, setRet] = useState(false);
  const [vq, setVq] = useState(String(r.submittedQty ?? ''));
  const [note, setNote] = useState('');
  const base = `/projects/${ctx.projectId}/measurements/${r.id}`;
  const sub = useAction(ctx, () => api.post(`${base}/submit-for-verification`), 'Submitted for site verification');
  const ver = useAction(ctx, () => api.post(`${base}/verify`, { verifiedQty: vq, note: note || undefined }), 'Measurement verified', () => setVerify(false));
  const back = useAction(ctx, () => api.post(`${base}/return-for-correction`, { note }), 'Returned for correction', () => setRet(false));
  const cert = useAction(ctx, () => api.post(`/projects/${ctx.projectId}/r/measurements/${r.id}/submit`), 'Sent for certification');
  const s = String(r.status);
  return (
    <>
      {['DRAFT', 'RETURNED'].includes(s) && ctx.can('measurement.manage') && (
        <Button loading={sub.isPending} onClick={() => sub.mutate(undefined)}>
          Submit for verification
        </Button>
      )}
      {s === 'SUBMITTED' && ctx.can('measurement.approve') && (
        <>
          <Button variant="success" icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setVerify(true)}>
            Verify
          </Button>
          <Button variant="outline" onClick={() => setRet(true)}>
            Return
          </Button>
        </>
      )}
      {s === 'VERIFIED' && ctx.can('measurement.manage') && (
        <Button icon={<ShieldCheck className="h-4 w-4" />} loading={cert.isPending} onClick={() => cert.mutate(undefined)}>
          Send for certification
        </Button>
      )}
      <Dialog open={verify} onOpenChange={setVerify} title="Site verification" description="Record the quantity verified on site. You cannot verify a measurement you recorded or submitted." footer={<Button variant="success" loading={ver.isPending} disabled={!vq} onClick={() => ver.mutate(undefined)}>Confirm verification</Button>}>
        <div className="space-y-3">
          <p className="text-sm">
            Contractor-submitted: <strong>{formatQty(String(r.submittedQty))} {String(r.unit)}</strong> · calculated {formatQty(String(r.calculatedQty))}
          </p>
          <Field label={`Verified quantity (${String(r.unit)})`} required>
            <Input inputMode="decimal" value={vq} onChange={(e) => setVq(e.target.value)} autoFocus />
          </Field>
          <Field label="Verification note">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain any difference" />
          </Field>
        </div>
      </Dialog>
      <Dialog open={ret} onOpenChange={setRet} title="Return for correction" footer={<Button loading={back.isPending} disabled={note.trim().length < 3} onClick={() => back.mutate(undefined)}>Return</Button>}>
        <Field label="What needs correcting?" required>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}

function MeasurementRevisions({ record }: { record: Rec }) {
  const revs = (record.revisions as Array<{ id: string; revision: number; reason: string; createdAt: string; snapshot: Record<string, unknown> }>) ?? [];
  if (!revs.length) return <p className="text-sm text-muted">No revisions — the measurement has not been corrected after a return.</p>;
  return (
    <ul className="space-y-2">
      {revs.map((r) => (
        <li key={r.id} className="rounded-lg border border-line p-3 text-sm">
          <p className="font-medium">
            Revision {r.revision} — {r.reason}
          </p>
          <p className="text-muted">
            Previous qty {formatQty(String(r.snapshot.calculatedQty))} ({String(r.snapshot.formula ?? '')}) · saved {formatDateTime(r.createdAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

// ───────── Tasks ─────────

function TaskActions({ ctx }: { ctx: ExtensionContext }) {
  const r = ctx.record;
  const [handover, setHandover] = useState(false);
  const [to, setTo] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const setStatus = useAction(ctx, (status) => api.patch(`/projects/${ctx.projectId}/r/tasks/${r.id}`, { status }), 'Task updated');
  const hand = useAction(ctx, () => api.post(`/projects/${ctx.projectId}/tasks/${r.id}/handover`, { toUserId: to, notes }), 'Task handed over', () => setHandover(false));
  if (!ctx.can('task.manage')) return null;
  const s = String(r.status);
  const next: Array<[string, string]> = s === 'BACKLOG' || s === 'ASSIGNED' ? [['IN_PROGRESS', 'Start']] : s === 'IN_PROGRESS' ? [['IN_REVIEW', 'Submit for review'], ['BLOCKED', 'Mark blocked'], ['WAITING_INFO', 'Waiting for info']] : s === 'IN_REVIEW' ? [['COMPLETED', 'Complete'], ['CHANGES_REQUESTED', 'Request changes']] : ['BLOCKED', 'WAITING_INFO', 'CHANGES_REQUESTED'].includes(s) ? [['IN_PROGRESS', 'Resume']] : [];
  return (
    <>
      {next.map(([st, label]) => (
        <Button key={st} variant={st === 'COMPLETED' ? 'success' : 'outline'} loading={setStatus.isPending && setStatus.variables === st} onClick={() => setStatus.mutate(st)}>
          {label}
        </Button>
      ))}
      {!['COMPLETED', 'CANCELLED'].includes(s) && (
        <Button variant="outline" icon={<Users className="h-4 w-4" />} onClick={() => setHandover(true)}>
          Hand over
        </Button>
      )}
      <Dialog open={handover} onOpenChange={setHandover} title="Hand over task" footer={<Button loading={hand.isPending} disabled={!to || notes.trim().length < 3} onClick={() => hand.mutate(undefined)}>Hand over</Button>}>
        <div className="space-y-3">
          <Field label="New owner" required>
            <RefSelect source="users" value={to} onChange={setTo} params={{ members: 'true' }} />
          </Field>
          <Field label="Handover notes" required>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Status, open points, where files are…" />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

function TaskPanel({ record }: { record: Rec }) {
  const hand = (record.handovers as Array<{ id: string; notes: string; createdAt: string }>) ?? [];
  return (
    <div className="space-y-4">
      <Notice>Completing a task never approves a linked financial or compliance document — approvals go through the workflow.</Notice>
      <DescriptionList items={[{ label: 'Status', value: TASK_STATUS_LABEL[record.status as keyof typeof TASK_STATUS_LABEL] }, { label: 'Contributors', value: `${(record.contributors as unknown[] | undefined)?.length ?? 0}` }, { label: 'Dependencies', value: `${(record.dependencies as unknown[] | undefined)?.length ?? 0}` }, { label: 'Completed at', value: record.completedAt ? formatDateTime(String(record.completedAt)) : null }]} />
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase text-muted">Handover history</h4>
        {hand.length === 0 ? <p className="text-sm text-muted">No handovers.</p> : hand.map((h) => <p key={h.id} className="border-t border-line py-1.5 text-sm">{formatDateTime(h.createdAt)} — {h.notes}</p>)}
      </div>
    </div>
  );
}

// ───────── Documents & transmittals ─────────

interface Revision {
  id: string;
  revision: string;
  status: string;
  fileId: string | null;
  issueDate: string | null;
  description: string | null;
  approvedAt: string | null;
  createdAt: string;
}

function DocumentRevisions({ ctx }: { ctx: ExtensionContext }) {
  const revs = (ctx.record.revisions as Revision[]) ?? [];
  const [open, setOpen] = useState(false);
  const [rev, setRev] = useState('');
  const [desc, setDesc] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const add = useAction(
    ctx,
    () => {
      const f = new FormData();
      f.append('revision', rev);
      f.append('description', desc);
      if (file) f.append('file', file);
      return api.upload(`/projects/${ctx.projectId}/documents/${ctx.record.id}/revisions`, f);
    },
    'Revision added',
    () => setOpen(false),
  );
  const submit = useAction(ctx, (id) => api.post(`/projects/${ctx.projectId}/document-revisions/${id}/submit`), 'Revision submitted for approval');
  return (
    <div className="space-y-3">
      <Notice>Approved revisions are never overwritten. Approving a new revision supersedes the previous current revision.</Notice>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {revs.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
            <div>
              <p className="text-sm font-medium">
                Rev {r.revision} {ctx.record.currentRevisionId === r.id && <Badge tone="success">Current approved</Badge>}
              </p>
              <p className="text-xs text-muted">
                {r.description} · issued {formatDate(r.issueDate)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={r.status} />
              {r.fileId && (
                <a className="text-sm text-brand-600 hover:underline" href={api.url(`/files/${r.fileId}`)} target="_blank" rel="noreferrer">
                  Open file
                </a>
              )}
              {['WIP', 'FOR_REVIEW', 'RETURNED'].includes(r.status) && ctx.can('document.manage') && (
                <Button size="sm" loading={submit.isPending} onClick={() => submit.mutate(r.id)}>
                  Submit
                </Button>
              )}
            </div>
          </li>
        ))}
        {!revs.length && <li className="px-3 py-4 text-sm text-muted">No revisions yet.</li>}
      </ul>
      {ctx.can('document.manage') && (
        <Button variant="outline" icon={<FileUp className="h-4 w-4" />} onClick={() => setOpen(true)}>
          Add revision
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen} title="Add revision" footer={<Button loading={add.isPending} disabled={!rev} onClick={() => add.mutate(undefined)}>Upload</Button>}>
        <div className="space-y-3">
          <Field label="Revision code" required help="e.g. A, B, 0, 1 — must be new">
            <Input value={rev} onChange={(e) => setRev(e.target.value.toUpperCase())} maxLength={10} />
          </Field>
          <Field label="Description">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
          <Field label="File (PDF / image)">
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

function TransmittalActions({ ctx }: { ctx: ExtensionContext }) {
  const [send, setSend] = useState(false);
  const [ack, setAck] = useState(false);
  const [ackBy, setAckBy] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const docs = useQuery({ queryKey: ['p', 'approved-revs', ctx.projectId], queryFn: () => api.get<{ items: Array<Rec & { revisions: Revision[] }> }>(`/projects/${ctx.projectId}/r/documents`, { pageSize: 200 }), enabled: send });
  const mSend = useAction(ctx, () => api.post(`/projects/${ctx.projectId}/transmittals/${ctx.record.id}/send`, { revisionIds: selected }), 'Transmittal sent', () => setSend(false));
  const mAck = useAction(ctx, () => api.post(`/projects/${ctx.projectId}/transmittals/${ctx.record.id}/acknowledge`, { acknowledgedBy: ackBy }), 'Acknowledgement recorded', () => setAck(false));
  if (!ctx.can('rfi.manage')) return null;
  return (
    <>
      {ctx.record.status === 'DRAFT' && (
        <Button icon={<Upload className="h-4 w-4" />} onClick={() => setSend(true)}>
          Send
        </Button>
      )}
      {ctx.record.status === 'SENT' && (
        <Button variant="success" onClick={() => setAck(true)}>
          Record acknowledgement
        </Button>
      )}
      <Dialog open={send} onOpenChange={setSend} title="Send transmittal" description="Select the current approved revisions to transmit." footer={<Button loading={mSend.isPending} disabled={!selected.length} onClick={() => mSend.mutate(undefined)}>Send</Button>}>
        {docs.isLoading && <LoadingBlock rows={3} />}
        <ul className="space-y-1">
          {docs.data?.items
            .filter((d) => d.currentRevisionId)
            .map((d) => (
              <li key={d.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selected.includes(String(d.currentRevisionId))} onChange={(e) => setSelected(e.target.checked ? [...selected, String(d.currentRevisionId)] : selected.filter((x) => x !== d.currentRevisionId))} />
                  {String(d.number)} — {String(d.title)}
                </label>
              </li>
            ))}
        </ul>
      </Dialog>
      <Dialog open={ack} onOpenChange={setAck} title="Record acknowledgement" footer={<Button loading={mAck.isPending} disabled={ackBy.trim().length < 2} onClick={() => mAck.mutate(undefined)}>Save</Button>}>
        <Field label="Acknowledged by" required>
          <Input value={ackBy} onChange={(e) => setAckBy(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}

function ClausesPanel({ ctx }: { ctx: ExtensionContext }) {
  const clauses = (ctx.record.clauses as Array<{ id: string; clauseRef: string; category: string; sourceText: string; interpretation: string | null; validatedAt: string | null }>) ?? [];
  const guarantees = (ctx.record.guarantees as Array<{ id: string; type: string; reference: string; amount: string; expiryDate: string; status: string }>) ?? [];
  const v = useAction(ctx, (id) => api.post(`/projects/${ctx.projectId}/contract-clauses/${id}/validate`), 'Interpretation validated');
  return (
    <div className="space-y-5">
      <Notice tone="warning">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Interpretations are unofficial until an authorised user validates them against the source clause. The system does not infer legal obligations.
      </Notice>
      {clauses.map((c) => (
        <div key={c.id} className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              Clause {c.clauseRef} <Badge>{humanize(c.category)}</Badge>
            </p>
            {c.validatedAt ? <Badge tone="success">Validated {formatDate(c.validatedAt)}</Badge> : c.interpretation ? <Badge tone="warning">Unvalidated interpretation</Badge> : null}
          </div>
          <blockquote className="mt-2 border-l-2 border-line pl-3 text-sm italic text-ink">{c.sourceText}</blockquote>
          {c.interpretation && <p className="mt-2 text-sm text-muted">Interpretation: {c.interpretation}</p>}
          {c.interpretation && !c.validatedAt && ctx.can('contract.approve') && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => v.mutate(c.id)}>
              Validate interpretation
            </Button>
          )}
        </div>
      ))}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase text-muted">Guarantees & insurance</h4>
        {guarantees.map((g) => {
          const days = Math.round((new Date(g.expiryDate).getTime() - Date.now()) / 86_400_000);
          return (
            <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-sm">
              <span>
                {humanize(g.type)} · {g.reference} · {formatMoney(g.amount)}
              </span>
              <span className="flex items-center gap-2">
                <span className={cx(days < 30 && 'font-semibold text-red-600')}>expires {formatDate(g.expiryDate)}</span>
                <StatusBadge status={g.status} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StockCountActions({ ctx }: { ctx: ExtensionContext }) {
  const [open, setOpen] = useState(false);
  const m = useAction(ctx, () => api.post(`/projects/${ctx.projectId}/stock/counts/${ctx.record.id}/post`), 'Count posted — variances adjusted', () => setOpen(false));
  if (ctx.record.status !== 'DRAFT' || !ctx.can('stock.manage')) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>Post count</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title="Post physical count?" message="Each variance becomes an ADJUSTMENT stock transaction. Posted counts cannot be edited." confirmLabel="Post" loading={m.isPending} onConfirm={() => m.mutate(undefined)} />
    </>
  );
}

function SubcontractActions({ ctx }: { ctx: ExtensionContext }) {
  const navigate = useNavigate();
  if (ctx.record.status !== 'APPROVED' || !ctx.can('subbill.manage')) return null;
  return (
    <Button icon={<Handshake className="h-4 w-4" />} onClick={() => navigate(`/subcontractor-bills?new=${ctx.record.id}`)}>
      Raise RA bill
    </Button>
  );
}

interface Dep {
  id: string;
  type: string;
  lagDays: number;
  predecessor: { id: string; code: string; name: string };
  successor: { id: string; code: string; name: string };
}

const DEP_TYPES = [
  { value: 'FS', label: 'Finish → Start (FS)' },
  { value: 'SS', label: 'Start → Start (SS)' },
  { value: 'FF', label: 'Finish → Finish (FF)' },
  { value: 'SF', label: 'Start → Finish (SF)' },
];

function DependenciesPanel({ ctx }: { ctx: ExtensionContext }) {
  const qc = useQueryClient();
  const base = `/projects/${ctx.projectId}/schedule/dependencies`;
  const q = useQuery({ queryKey: ['p', 'deps', ctx.projectId], queryFn: () => api.get<Dep[]>(base) });
  const [form, setForm] = useState<{ predecessorId: string | null; type: string; lagDays: string }>({ predecessorId: null, type: 'FS', lagDays: '0' });
  const done = () => void qc.invalidateQueries({ queryKey: ['p'] });
  const add = useMutation({ mutationFn: () => api.post(base, { predecessorId: form.predecessorId, successorId: ctx.record.id, type: form.type, lagDays: Number(form.lagDays || 0) }), onSuccess: () => { toast.success('Predecessor added'); setForm({ predecessorId: null, type: 'FS', lagDays: '0' }); done(); }, onError: (e: Error) => toast.error(e.message) });
  const del = useMutation({ mutationFn: (id: string) => api.del(`${base}/${id}`), onSuccess: () => { toast.success('Dependency removed'); done(); }, onError: (e: Error) => toast.error(e.message) });
  if (q.isLoading) return <LoadingBlock rows={3} />;
  const preds = (q.data ?? []).filter((d) => d.successor.id === ctx.record.id);
  const succs = (q.data ?? []).filter((d) => d.predecessor.id === ctx.record.id);
  const lag = (d: Dep) => (d.lagDays ? ` ${d.lagDays > 0 ? '+' : ''}${d.lagDays} d` : '');
  const canEdit = ctx.can('progress.manage');
  const row = (d: Dep, other: { code: string; name: string }) => (
    <li key={d.id} className="flex items-center justify-between gap-2 border-t border-line py-2 text-sm">
      <span><strong>{other.code}</strong> {other.name} <Badge tone="info">{d.type}{lag(d)}</Badge></span>
      {canEdit && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => del.mutate(d.id)}>Remove</Button>}
    </li>
  );
  return (
    <div className="space-y-5">
      <Notice>Dependencies drive the critical path on the Schedule page. Example: “Raft” must finish before “Columns” start = predecessor Raft, type FS.</Notice>
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase text-muted">Predecessors (must happen first)</h4>
        {preds.length ? <ul>{preds.map((d) => row(d, d.predecessor))}</ul> : <p className="text-sm text-muted">None.</p>}
      </div>
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase text-muted">Successors (depend on this activity)</h4>
        {succs.length ? <ul>{succs.map((d) => row(d, d.successor))}</ul> : <p className="text-sm text-muted">None.</p>}
      </div>
      {canEdit && (
        <div className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[2fr_1.4fr_0.7fr_auto] sm:items-end">
          <Field label="Add predecessor"><RefSelect source="activities" value={form.predecessorId} onChange={(v) => setForm({ ...form, predecessorId: v })} /></Field>
          <Field label="Type">
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {DEP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Lag (days)"><Input inputMode="numeric" value={form.lagDays} onChange={(e) => setForm({ ...form, lagDays: e.target.value })} /></Field>
          <Button loading={add.isPending} disabled={!form.predecessorId || form.predecessorId === ctx.record.id} onClick={() => add.mutate()}>Add</Button>
        </div>
      )}
    </div>
  );
}

export const EXTENSIONS: Record<string, Extension> = {
  mrs: { actions: (ctx) => <MrActions ctx={ctx} /> },
  activities: { panels: (ctx) => [{ value: 'deps', label: 'Dependencies', render: () => <DependenciesPanel ctx={ctx} /> }] },
  prs: { actions: (ctx) => <PrActions ctx={ctx} />, panels: (ctx) => [{ value: 'budget', label: 'Budget check', render: () => <BudgetCheckPanel record={ctx.record} /> }] },
  purchaseOrders: {
    actions: (ctx) => <PoActions ctx={ctx} />,
    panels: (ctx) => [
      { value: 'recon', label: 'Receipts & invoices', render: () => <PoReconciliation ctx={ctx} /> },
      { value: 'budget', label: 'Budget check', render: () => <BudgetCheckPanel record={ctx.record} /> },
      { value: 'amendments', label: 'Amendments', render: () => <PoRevisions ctx={ctx} /> },
    ],
    banner: (ctx) => (['DRAFT', 'SUBMITTED', 'RETURNED'].includes(String(ctx.record.status)) ? <Notice>A PO becomes a commitment only when approved. Issuing a PO is not cost.</Notice> : null),
  },
  supplierInvoices: {
    panels: (ctx) => [{ value: 'match', label: 'Three-way match', render: () => <InvoiceMatch record={ctx.record} /> }],
    banner: (ctx) => (ctx.record.duplicateWarning ? <Notice tone="warning"><AlertTriangle className="h-4 w-4" />{String(ctx.record.duplicateWarning)}</Notice> : ctx.record.status === 'EXCEPTION' ? <Notice tone="warning"><AlertTriangle className="h-4 w-4" />Three-way match exception — see the match tab.</Notice> : null),
  },
  measurements: {
    actions: (ctx) => <MeasurementActions ctx={ctx} />,
    panels: (ctx) => [{ value: 'revisions', label: 'Revisions', render: () => <MeasurementRevisions record={ctx.record} /> }],
    banner: (ctx) => (ctx.record.verificationNote ? <Notice tone={ctx.record.status === 'RETURNED' ? 'warning' : 'info'}>Verification note: {String(ctx.record.verificationNote)}</Notice> : null),
  },
  tasks: { actions: (ctx) => <TaskActions ctx={ctx} />, panels: (ctx) => [{ value: 'task', label: 'Work log', render: () => <TaskPanel record={ctx.record} /> }] },
  documents: { panels: (ctx) => [{ value: 'revisions', label: 'Revisions', render: () => <DocumentRevisions ctx={ctx} /> }] },
  transmittals: { actions: (ctx) => <TransmittalActions ctx={ctx} /> },
  contracts: { panels: (ctx) => [{ value: 'clauses', label: 'Clauses & guarantees', render: () => <ClausesPanel ctx={ctx} /> }] },
  stockCounts: { actions: (ctx) => <StockCountActions ctx={ctx} /> },
  subcontracts: { actions: (ctx) => <SubcontractActions ctx={ctx} /> },
  manpowerReports: { banner: (ctx) => (ctx.record.contractorId ? <Notice>Subcontractor labour is recorded for productivity and evidence only; its cost comes through the subcontractor’s RA bills.</Notice> : null) },
  variations: { banner: (ctx) => (['SUBMITTED', 'PENDING_CLIENT', 'DISPUTED'].includes(String(ctx.record.status)) ? <Notice tone="warning">Pending variation — shown as cost exposure, not included in the approved budget.</Notice> : null) },
  budgetRevisions: { banner: () => <Notice>Only approved revisions change the approved budget. Transfers must net to zero.</Notice> },
  grns: { banner: (ctx) => (ctx.record.status === 'APPROVED' ? <Notice tone="success"><CheckCircle2 className="h-4 w-4" />Posted: accepted quantities added to stock; value moved from commitment to accrual.</Notice> : null) },
};

