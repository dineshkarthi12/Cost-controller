import type { ApprovalRequest } from '@prisma/client';
import type { Tx } from '../../lib/prisma.js';
import type { AccessContext } from '../access.js';

export interface WorkflowEntity {
  id: string;
  projectId: string;
  number?: string | null;
  status: string;
  [k: string]: unknown;
}

export interface SubmitInfo {
  amount?: string | null;
  title?: string;
  /** Status the entity takes while pending approval (default SUBMITTED). */
  status?: string;
  /** Extra columns to persist on submit (e.g. budget check results). */
  data?: Record<string, unknown>;
}

export interface DocHandler {
  docType: string;
  /** Permission area — approvers need `${area}.approve`. */
  area: string;
  /** Prisma delegate name. */
  model: string;
  /** Front-end route to the record. */
  link: (e: WorkflowEntity) => string;
  /** Statuses from which the document may be submitted. */
  submittableStatuses?: string[];
  validateSubmit?: (tx: Tx, ctx: AccessContext, e: WorkflowEntity) => Promise<SubmitInfo>;
  onApproved?: (tx: Tx, ctx: AccessContext, e: WorkflowEntity, req: ApprovalRequest) => Promise<void>;
  onRejected?: (tx: Tx, ctx: AccessContext, e: WorkflowEntity, req: ApprovalRequest) => Promise<void>;
  onReturned?: (tx: Tx, ctx: AccessContext, e: WorkflowEntity, req: ApprovalRequest) => Promise<void>;
  /** Status after final approval (default APPROVED). */
  approvedStatus?: string;
  returnedStatus?: string;
  rejectedStatus?: string;
  cancelledStatus?: string;
}
