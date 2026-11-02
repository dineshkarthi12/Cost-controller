/** Daily work report (office QS / estimation team): categories, statuses and the plan-vs-done rule. */
export const WORK_CATEGORIES = {
  ESTIMATION: 'Estimation / costing',
  BOQ: 'BOQ preparation',
  BOM: 'BOM / material take-off',
  RATE_ANALYSIS: 'Rate analysis',
  QUANTITY_TAKEOFF: 'Quantity take-off',
  MEASUREMENT: 'Measurement / MB check',
  BILLING: 'Client / contractor bill',
  VENDOR_COMPARISON: 'Quotation comparison',
  COST_REPORT: 'Cost report / budget',
  DRAWING_REVIEW: 'Drawing study',
  SITE_VISIT: 'Site visit',
  MEETING: 'Meeting',
  DOCUMENTATION: 'Documentation / correspondence',
  OTHER: 'Other',
} as const;
export type WorkCategory = keyof typeof WORK_CATEGORIES;
export const WORK_ITEM_STATUSES = ['DONE', 'IN_PROGRESS', 'BLOCKED', 'NOT_STARTED'] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

/** Share of yesterday's plan finished today: items carried from the plan and marked done. */
export function planCompletion(planned: number, doneFromPlan: number): number | null {
  return planned > 0 ? Math.round((doneFromPlan / planned) * 1000) / 1000 : null;
}
