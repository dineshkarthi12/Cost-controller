/** Status vocabularies shared by API validation and UI badges. */
export const DOC_STATUS = ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type DocStatus = (typeof DOC_STATUS)[number];

export const PO_STATUS = ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED', 'REJECTED'] as const;
export const GRN_STATUS = ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const INVOICE_STATUS = ['DRAFT', 'SUBMITTED', 'EXCEPTION', 'RETURNED', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'REJECTED', 'CANCELLED'] as const;
export const MEASUREMENT_STATUS = ['DRAFT', 'SUBMITTED', 'RETURNED', 'VERIFIED', 'PENDING_CERTIFICATION', 'CERTIFIED', 'REJECTED', 'CANCELLED'] as const;
export const BILL_STATUS = ['DRAFT', 'SUBMITTED', 'RETURNED', 'CERTIFIED', 'PARTIALLY_PAID', 'PAID', 'REJECTED', 'CANCELLED', 'DISPUTED'] as const;
export const EVIDENCE_STATUS = ['PENDING', 'VERIFIED', 'REJECTED', 'CORRECTION_REQUIRED'] as const;
export const TASK_STATUS = ['BACKLOG', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_INFO', 'BLOCKED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'COMPLETED', 'CANCELLED'] as const;
export const TASK_STATUS_LABEL: Record<(typeof TASK_STATUS)[number], string> = {
  BACKLOG: 'Backlog',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  WAITING_INFO: 'Waiting for Information',
  BLOCKED: 'Blocked',
  IN_REVIEW: 'Submitted for Review',
  CHANGES_REQUESTED: 'Changes Requested',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
export const PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const VARIATION_STATUS = ['DRAFT', 'SUBMITTED', 'PENDING_CLIENT', 'APPROVED', 'REJECTED', 'DISPUTED', 'CANCELLED', 'RETURNED'] as const;
export const PERIOD_STATUS = ['OPEN', 'CLOSING', 'CLOSED'] as const;
export const PROJECT_STATUS = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CLOSED', 'CANCELLED'] as const;

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';

const TONES: Record<string, Tone> = {
  DRAFT: 'neutral',
  BACKLOG: 'neutral',
  PLANNING: 'neutral',
  SUBMITTED: 'info',
  PENDING: 'warning',
  PENDING_CERTIFICATION: 'info',
  PENDING_CLIENT: 'warning',
  UNDER_REVIEW: 'info',
  IN_REVIEW: 'info',
  ASSIGNED: 'info',
  IN_PROGRESS: 'primary',
  ACTIVE: 'success',
  OPEN: 'info',
  CLOSING: 'warning',
  RETURNED: 'warning',
  CORRECTION_REQUIRED: 'warning',
  CHANGES_REQUESTED: 'warning',
  WAITING_INFO: 'warning',
  EXCEPTION: 'warning',
  PARTIALLY_RECEIVED: 'warning',
  PARTIALLY_PAID: 'warning',
  ON_HOLD: 'warning',
  DISPUTED: 'danger',
  BLOCKED: 'danger',
  REJECTED: 'danger',
  OVERDUE: 'danger',
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'neutral',
  APPROVED: 'success',
  VERIFIED: 'success',
  CERTIFIED: 'success',
  RECEIVED: 'success',
  PAID: 'success',
  COMPLETED: 'success',
  CLOSED: 'neutral',
  ACCEPTED: 'success',
  PASS: 'success',
  FAIL: 'danger',
  CANCELLED: 'neutral',
  SUPERSEDED: 'neutral',
  CURRENT: 'success',
  ISSUED: 'success',
  WARNING: 'warning',
  OK: 'success',
};

export function statusTone(status: string | null | undefined): Tone {
  if (!status) return 'neutral';
  return TONES[status] ?? 'neutral';
}

export function humanize(v: string | null | undefined): string {
  if (!v) return '—';
  return v
    .toLowerCase()
    .split('_')
    .map((w) => (w.length <= 3 && ['mr', 'pr', 'po', 'grn', 'mir', 'ncr', 'rfi', 'boq', 'ra', 'vo', 'eot', 'wir', 'mpr', 'dpr', 'jmr', 'mb', 'itp', 'lti'].includes(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
