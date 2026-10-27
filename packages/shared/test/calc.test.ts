import { describe, it, expect } from 'vitest';
import {
  computeCostPosition,
  rollupPositions,
  budgetAvailability,
  computeBill,
  computeEvm,
  calculateMeasurementQty,
  measurementVariance,
  priceDocument,
  threeWayMatch,
  validateGrnLine,
  weightedAverageAfterReceipt,
  valueIssue,
  labourLineCost,
  formatDocNumber,
  sequenceScope,
  formatMoneyCompact,
  money,
  sum,
  buildObjectSchema,
  RESOURCES,
  DEFAULT_ROLES,
  ALL_PERMISSIONS,
  MODULES,
} from '../src/index.js';

describe('money', () => {
  it('avoids floating point errors', () => {
    expect(money(sum(['0.1', '0.2']))).toBe('0.30');
    expect(money('2.675')).toBe('2.68'); // half-up, unlike Number#toFixed
  });
  it('formats Indian compact notation', () => {
    expect(formatMoneyCompact('500000000')).toBe('₹ 50.00 Cr');
    expect(formatMoneyCompact('1240000')).toBe('₹ 12.40 L');
  });
});

describe('cost position (BUSINESS_RULES §3)', () => {
  it('matches the dashboard example: 50 Cr budget, 28.75 actual, 8.20 committed', () => {
    const p = computeCostPosition({
      originalBudget: '500000000',
      approvedRevisions: '0',
      actual: '287500000',
      accrued: '0',
      openCommitments: '82000000',
      uncommittedEtc: '122500000',
    });
    expect(p.remainingBudget).toBe('130500000.00');
    expect(p.etc).toBe('204500000.00');
    expect(p.eac).toBe('492000000.00');
    expect(p.costVariance).toBe('8000000.00');
    expect(p.costVariancePct).toBe('0.0160');
    expect(p.forecastMethod).toBe('MANUAL');
    expect(p.alert).toBe('OK'); // 74% consumed, EAC within budget
    const warn = computeCostPosition({ originalBudget: '100', approvedRevisions: '0', actual: '80', accrued: '5', openCommitments: '11' });
    expect(warn.alert).toBe('WARNING'); // 96% consumed
  });

  it('defaults uncommitted ETC to remaining budget, floored at zero', () => {
    const p = computeCostPosition({ originalBudget: '100', approvedRevisions: '20', actual: '60', accrued: '10', openCommitments: '30' });
    expect(p.approvedBudget).toBe('120.00');
    expect(p.incurred).toBe('70.00');
    expect(p.remainingBudget).toBe('20.00');
    expect(p.eac).toBe('120.00');
    expect(p.costVariance).toBe('0.00');
    const over = computeCostPosition({ originalBudget: '100', approvedRevisions: '0', actual: '90', accrued: '0', openCommitments: '30' });
    expect(over.remainingBudget).toBe('-20.00');
    expect(over.uncommittedEtc).toBe('0.00');
    expect(over.eac).toBe('120.00');
    expect(over.alert).toBe('CRITICAL');
  });

  it('never counts pending cost or pending variations as actual or budget', () => {
    const p = computeCostPosition({ originalBudget: '100', approvedRevisions: '0', actual: '10', accrued: '0', openCommitments: '0', pending: '50', pendingVariationExposure: '40' });
    expect(p.actual).toBe('10.00');
    expect(p.approvedBudget).toBe('100.00');
    expect(p.pending).toBe('50.00');
    expect(p.pendingVariationExposure).toBe('40.00');
  });

  it('returns null CV% when budget is zero', () => {
    expect(computeCostPosition({ originalBudget: '0', approvedRevisions: '0', actual: '0', accrued: '0', openCommitments: '0' }).costVariancePct).toBeNull();
  });

  it('rolls up cost codes', () => {
    const a = computeCostPosition({ originalBudget: '100', approvedRevisions: '0', actual: '50', accrued: '0', openCommitments: '0' });
    const b = computeCostPosition({ originalBudget: '200', approvedRevisions: '10', actual: '20', accrued: '5', openCommitments: '15', uncommittedEtc: '100' });
    const r = rollupPositions([a, b]);
    expect(r.approvedBudget).toBe('310.00');
    expect(r.incurred).toBe('75.00');
    expect(r.eac).toBe(money(sum([a.eac, b.eac])));
  });

  it('checks budget availability', () => {
    expect(budgetAvailability('1000', '1200').exceeded).toBe(true);
    expect(budgetAvailability('1000', '999.99').after).toBe('0.01');
  });
});

describe('RA bill calculation (BUSINESS_RULES §5)', () => {
  const terms = {
    contractValue: '1000000',
    retentionPct: '0.05',
    retentionCapPct: null,
    advanceRecoveryPct: '0.10',
    advanceOutstanding: '50000',
    taxRate: '0.18',
    previousGross: '0',
    previousRetention: '0',
  };
  it('computes the first bill', () => {
    const r = computeBill([{ previousQty: '0', currentQty: '100', rate: '1500' }], terms);
    expect(r.currentWorkValue).toBe('150000.00');
    expect(r.retention).toBe('7500.00');
    expect(r.advanceRecovery).toBe('15000.00');
    expect(r.taxAmount).toBe('27000.00');
    expect(r.netPayable).toBe('154500.00');
  });
  it('computes subsequent bills on cumulative basis and caps advance recovery', () => {
    const r = computeBill([{ previousQty: '100', currentQty: '300', rate: '1500' }], { ...terms, previousGross: '150000', advanceOutstanding: '35000', previousRetention: '7500' });
    expect(r.grossToDate).toBe('600000.00');
    expect(r.currentWorkValue).toBe('450000.00');
    expect(r.advanceRecovery).toBe('35000.00');
    expect(r.lines[0].cumulativeQty).toBe('400.000');
  });
  it('caps retention at the contract cap', () => {
    const r = computeBill([{ previousQty: '0', currentQty: '1000', rate: '1000' }], { ...terms, retentionCapPct: '0.025', previousRetention: '20000' });
    expect(r.retention).toBe('5000.00');
  });
  it('includes approved variations and other deductions', () => {
    const r = computeBill([{ previousQty: '0', currentQty: '10', rate: '100' }], { ...terms, approvedVariationsToDate: '500', otherDeductions: '100', advanceRecoveryPct: '0', taxRate: '0' });
    expect(r.currentWorkValue).toBe('1500.00');
    expect(r.netPayable).toBe('1325.00');
  });
});

describe('earned value', () => {
  const asOf = new Date('2025-03-16T00:00:00Z');
  it('computes CPI and SPI', () => {
    const r = computeEvm(
      [
        { weight: '1', percentComplete: '100', baselineStart: '2025-01-01', baselineFinish: '2025-02-01' },
        { weight: '1', percentComplete: '20', baselineStart: '2025-03-01', baselineFinish: '2025-03-31' },
      ],
      '1000',
      '700',
      asOf,
    );
    expect(r.physicalPct).toBe('0.6000');
    expect(r.ev).toBe('600.00');
    expect(r.cpi).toBe('0.857');
    expect(r.plannedPct).toBe('0.7500');
    expect(r.spi).toBe('0.800');
  });
  it('explains when not calculable', () => {
    const r = computeEvm([], '1000', '0', asOf);
    expect(r.cpi).toBeNull();
    expect(r.notes[0]).toMatch(/No weighted activities/);
    const r2 = computeEvm([{ weight: '1', percentComplete: '50' }], '1000', '0', asOf);
    expect(r2.spi).toBeNull();
    expect(r2.notes.join(' ')).toMatch(/baseline/);
    expect(r2.notes.join(' ')).toMatch(/CPI cannot/);
  });
});

describe('measurement', () => {
  it('multiplies only the dimensions given', () => {
    expect(calculateMeasurementQty({ nos: '2', length: '5.5', width: '0.3', depth: '0.45' }).quantity).toBe('1.485');
    expect(calculateMeasurementQty({ length: '12' }).formula).toBe('L 12');
    expect(() => calculateMeasurementQty({})).toThrow();
  });
  it('computes variance', () => {
    expect(measurementVariance('100', '95')).toEqual({ difference: '-5.000', pct: '-0.0500' });
  });
});

describe('procurement', () => {
  it('prices a document with discount and tax', () => {
    const d = priceDocument([
      { quantity: '10', rate: '100', discountPct: '0.1', taxRate: '0.18' },
      { quantity: '3', rate: '33.33', taxRate: '0.05' },
    ]);
    expect(d.netAmount).toBe('999.99');
    expect(d.taxAmount).toBe('167.00');
    expect(d.total).toBe('1166.99');
  });
  it('three-way matches and flags exceptions', () => {
    const ok = threeWayMatch([{ lineRef: '1', invoicedQty: '50', invoicedRate: '100', poRate: '100', orderedQty: '100', acceptedQty: '60', previouslyInvoicedQty: '10' }]);
    expect(ok.matched).toBe(true);
    const bad = threeWayMatch([{ lineRef: '1', invoicedQty: '60', invoicedRate: '110', poRate: '100', orderedQty: '100', acceptedQty: '60', previouslyInvoicedQty: '10' }]);
    expect(bad.matched).toBe(false);
    expect(bad.lines[0].issues).toHaveLength(2);
  });
  it('validates GRN lines', () => {
    expect(validateGrnLine({ orderedQty: '100', previouslyAcceptedQty: '0', receivedQty: '40', acceptedQty: '38', rejectedQty: '2' })).toEqual([]);
    expect(validateGrnLine({ orderedQty: '100', previouslyAcceptedQty: '90', receivedQty: '20', acceptedQty: '20', rejectedQty: '0' })).toContain('Cumulative accepted qty exceeds ordered qty (beyond tolerance)');
    expect(validateGrnLine({ orderedQty: '100', previouslyAcceptedQty: '0', receivedQty: '20', acceptedQty: '10', rejectedQty: '5' })).toContain('Accepted + rejected must equal received');
  });
});

describe('stock & labour', () => {
  it('computes weighted average and values issues', () => {
    const w = weightedAverageAfterReceipt('100', '1000', '100', '12');
    expect(w.unitCost).toBe('11.0000');
    expect(valueIssue('200', '2200', '50')).toEqual({ unitCost: '11.0000', value: '550.00' });
    expect(() => valueIssue('10', '100', '11')).toThrow(/Insufficient stock/);
  });
  it('computes labour cost', () => {
    expect(labourLineCost({ actualCount: '10', regularHours: '8', overtimeHours: '2', hourlyRate: '100', overtimeRate: '150' })).toBe('11000.00');
  });
});

describe('numbering', () => {
  it('formats tokens', () => {
    const date = new Date('2025-03-15T00:00:00Z');
    expect(formatDocNumber('{PROJECT}-{ABBR}-{SEQ:4}', { project: 'RH', abbr: 'PO', date, seq: 7 })).toBe('RH-PO-0007');
    expect(formatDocNumber('{ABBR}/{YY}{MM}/{SEQ:3}', { project: 'RH', abbr: 'GRN', date, seq: 12 })).toBe('GRN/2503/012');
    expect(sequenceScope('p1', 'YEARLY', date)).toBe('p1:2025');
  });
});

describe('resource metadata', () => {
  it('builds strict schemas that reject computed fields', () => {
    const s = buildObjectSchema(RESOURCES.expenses.fields, 'create');
    const parsed = s.parse({ date: '2025-03-01', category: 'TRANSPORT', costCodeId: 'cc1', description: 'Trucking', amountBeforeTax: '100.50', total: '999999' });
    expect(parsed).not.toHaveProperty('total');
    expect(() => s.parse({ date: '2025-03-01', category: 'NOPE', costCodeId: 'cc1', description: 'x' })).toThrow();
    expect(() => s.parse({ date: '2025-03-01', category: 'TRANSPORT', costCodeId: 'cc1', description: 'x', amountBeforeTax: '1.234' })).toThrow();
  });
  it('requires lines where configured', () => {
    const s = buildObjectSchema(RESOURCES.purchaseOrders.fields, 'create');
    expect(() => s.parse({ supplierId: 's', orderDate: '2025-03-01', lines: [] })).toThrow();
  });
  it('every role references known permissions and every module has a path', () => {
    for (const r of DEFAULT_ROLES) for (const p of r.permissions) expect(ALL_PERMISSIONS).toContain(p);
    expect(new Set(MODULES.map((m) => m.path)).size).toBe(MODULES.length);
    expect(MODULES.length).toBeGreaterThanOrEqual(47);
  });
});
