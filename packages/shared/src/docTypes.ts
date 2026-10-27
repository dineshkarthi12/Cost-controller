/** Default document types and numbering rules (configurable per organisation). */
export interface DocTypeDef {
  code: string;
  name: string;
  abbreviation: string;
  numberFormat: string;
  resetPolicy: 'NEVER' | 'YEARLY' | 'MONTHLY';
  workflow: boolean;
  financial: boolean; // approval limits apply
  permissionArea: string;
}

const F = '{PROJECT}-{ABBR}-{SEQ:4}';
const d = (code: string, name: string, abbreviation: string, permissionArea: string, workflow = true, financial = false, numberFormat = F): DocTypeDef => ({
  code,
  name,
  abbreviation,
  numberFormat,
  resetPolicy: 'NEVER',
  workflow,
  financial,
  permissionArea,
});

export const DEFAULT_DOC_TYPES: DocTypeDef[] = [
  d('MPR', 'Manpower Report', 'MPR', 'manpower'),
  d('DPR', 'Daily Progress Report / Site Diary', 'DPR', 'diary'),
  d('MR', 'Material Requisition', 'MR', 'procurement'),
  d('PR', 'Purchase Requisition', 'PR', 'procurement', true, true),
  d('RFQ', 'Request for Quotation', 'RFQ', 'procurement', false),
  d('PO', 'Purchase Order', 'PO', 'procurement', true, true),
  d('PO_AMENDMENT', 'Purchase Order Amendment', 'POA', 'procurement', true, true),
  d('GRN', 'Goods Receipt Note', 'GRN', 'receiving'),
  d('MIR', 'Material Inspection Report', 'MIR', 'receiving'),
  d('MATERIAL_ISSUE', 'Material Issue Note', 'MIN', 'stock'),
  d('STOCK_ADJUSTMENT', 'Stock Adjustment', 'ADJ', 'stock'),
  d('STOCK_TRANSFER', 'Stock Transfer', 'STN', 'stock', false),
  d('MSR', 'Material Stock / Status Report', 'MSR', 'stock', false),
  d('QTO', 'Quantity Takeoff', 'QTO', 'boq', false),
  d('MB', 'Measurement Book', 'MB', 'measurement'),
  d('JMR', 'Joint Measurement Record', 'JMR', 'measurement'),
  d('WIR', 'Work Inspection Request', 'WIR', 'quality', false),
  d('INSPECTION', 'Inspection Report', 'INS', 'quality', false),
  d('NCR', 'Non-Conformance Report', 'NCR', 'quality', false),
  d('HSE', 'HSE Report / Incident', 'HSE', 'safety', false),
  d('RFI', 'Request for Information', 'RFI', 'rfi', false),
  d('TRANSMITTAL', 'Transmittal', 'TRN', 'rfi', false),
  d('DOCUMENT', 'Controlled Document', 'DOC', 'document', false),
  d('DOCUMENT_REVISION', 'Document Revision Approval', 'DRA', 'document'),
  d('SUBCONTRACT', 'Subcontract / Work Order', 'WO', 'subcontract', true, true),
  d('CONTRACTOR_BILL', 'Subcontractor RA Bill', 'RA', 'subbill', true, true),
  d('CLIENT_BILL', 'Client RA Bill / IPC', 'IPC', 'clientbill', true, true),
  d('CREDIT_NOTE', 'Credit / Debit Note', 'CDN', 'clientbill', false, true),
  d('SUPPLIER_INVOICE', 'Supplier Invoice', 'INV', 'payable', true, true),
  d('PAYMENT', 'Payment Certificate / Voucher', 'PAY', 'payable', true, true),
  d('RECEIPT', 'Client Receipt', 'RCP', 'clientbill', false, true),
  d('EXPENSE', 'Expense Voucher', 'EXP', 'expense', true, true),
  d('BUDGET_REVISION', 'Budget Revision / Transfer', 'BRV', 'budget', true, true),
  d('VARIATION', 'Variation Order', 'VO', 'variation', true, true),
  d('CLAIM', 'Claim / EOT', 'CLM', 'risk', false),
  d('RISK', 'Risk', 'RSK', 'risk', false),
  d('EQUIPMENT_LOG', 'Equipment Log', 'EQL', 'equipment'),
  d('CONTRACT', 'Contract', 'CON', 'contract', false),
  d('TASK', 'Task', 'TSK', 'task', false, false, '{PROJECT}-{ABBR}-{SEQ:5}'),
  d('PERIOD_CLOSE', 'Month-End Close', 'MEC', 'period'),
  d('CVR', 'Cost Value Reconciliation', 'CVR', 'forecast', false),
  d('CLOSEOUT', 'Project Closeout', 'PCO', 'closeout'),
  d('SITE_INSTRUCTION', 'Site Instruction', 'SI', 'document', false),
  d('EVIDENCE', 'Site Evidence', 'EVD', 'evidence', false, false, '{PROJECT}-{ABBR}-{SEQ:5}'),
];

/** Formats a document number. Tokens: {PROJECT} {ABBR} {YYYY} {YY} {MM} {SEQ:n} */
export function formatDocNumber(format: string, ctx: { project: string; abbr: string; date: Date; seq: number }): string {
  const yyyy = String(ctx.date.getUTCFullYear());
  const mm = String(ctx.date.getUTCMonth() + 1).padStart(2, '0');
  return format
    .replace(/\{PROJECT\}/g, ctx.project)
    .replace(/\{ABBR\}/g, ctx.abbr)
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yyyy.slice(2))
    .replace(/\{MM\}/g, mm)
    .replace(/\{SEQ(?::(\d+))?\}/g, (_m, n) => String(ctx.seq).padStart(Number(n ?? 4), '0'));
}

/** Sequence scope key for the reset policy. */
export function sequenceScope(projectKey: string, policy: DocTypeDef['resetPolicy'], date: Date): string {
  if (policy === 'YEARLY') return `${projectKey}:${date.getUTCFullYear()}`;
  if (policy === 'MONTHLY') return `${projectKey}:${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return projectKey;
}
