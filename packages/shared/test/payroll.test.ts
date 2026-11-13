import { describe, expect, it } from 'vitest';
import { payrollRows } from '../src/index.js';

const mason = { id: 'w1', workerCode: 'W-001', name: 'Murugan', trade: 'Mason', category: 'SKILLED', hourlyRate: '150', contractor: null };
const helper = { id: 'w2', workerCode: 'W-002', name: 'Selvi', trade: 'Helper', category: 'UNSKILLED', hourlyRate: '100', contractor: null };

describe('payroll from attendance', () => {
  it('pays present and half days at the hourly rate, overtime at 1.5×, leave and absence unpaid', () => {
    const { rows, totals } = payrollRows(
      [mason, helper],
      [
        { workerId: 'w1', date: '2026-11-02', status: 'PRESENT', regularHours: '8', overtimeHours: '2' },
        { workerId: 'w1', date: '2026-11-03', status: 'HALF_DAY', regularHours: '4', overtimeHours: '0' },
        { workerId: 'w1', date: '2026-11-04', status: 'LEAVE', regularHours: '0', overtimeHours: '0' },
        { workerId: 'w1', date: '2026-11-05', status: 'ABSENT', regularHours: '0', overtimeHours: '0' },
        { workerId: 'w2', date: '2026-11-02', status: 'PRESENT', regularHours: '8', overtimeHours: '0' },
      ],
    );
    expect(rows[0]).toMatchObject({ present: 1, halfDays: 1, leave: 1, absent: 1, paidDays: '1.5', regularHours: '12.00', overtimeHours: '2.00', overtimeRate: '225.00', regularPay: '1800.00', overtimePay: '450.00', gross: '2250.00' });
    expect(rows[0].days).toEqual({ '2026-11-02': 'P', '2026-11-03': 'H', '2026-11-04': 'L', '2026-11-05': 'A' });
    expect(rows[1]).toMatchObject({ paidDays: '1', gross: '800.00' });
    expect(totals).toMatchObject({ workers: 2, paidDays: '2.5', regularHours: '20.00', overtimeHours: '2.00', gross: '3050.00' });
  });

  it('lists workers with no attendance at zero', () => {
    const { rows } = payrollRows([mason], []);
    expect(rows[0]).toMatchObject({ present: 0, paidDays: '0', gross: '0.00' });
  });
});
