import { describe, expect, it } from 'vitest';
import { defaultCrewSplit, gangProductivity, summariseProductivity, type GangInput } from '../src/index.js';

// Expected values are the results of TOPROCK's own workbook (Daily_Labour_Report_29-10-2026.xlsx),
// recalculated in LibreOffice.
const rates = { masonRate: 1300, helperRate: 1000 };
const n = (outputPerDay: number, masonsPerCrew: number, helpersPerCrew: number, unit: string) => ({ outputPerDay, masonsPerCrew, helpersPerCrew, unit });
const RFT = n(100, 1, 1, 'Rft');
const PAINT = n(240, 1, 0, 'Sq.ft');
const BRICK = n(600, 1, 2, 'Nos');
const BOARD = n(120, 1, 1, 'Sq.ft');

const day = (gangs: Array<GangInput & { unit?: string }>) => summariseProductivity(gangs.map((g) => ({ ...g, productivity: gangProductivity(g, rates) })));

describe('labour productivity (matches the TOPROCK workbook)', () => {
  it('aluminium frame: 125 Rft by 1 mason + 3 helpers is 125 % and a ₹1,075 profit', () => {
    const p = gangProductivity({ masons: 1, helpers: 3, doneQty: 125, norm: RFT }, rates);
    expect(p).toEqual({ labourCost: '4300.00', measured: true, outputPct: '1.2500', shouldDoQty: '100.0000', masonsNeeded: '1.2500', helpersNeeded: '1.2500', result: 'PROFIT', profitLoss: '1075.00' });
  });

  it('brick 70 Nos against 600 Nos/day is a loss; helpers needed follows the crew mix', () => {
    const p = gangProductivity({ masons: 1, helpers: 1, doneQty: 70, norm: BRICK }, rates);
    expect(p.outputPct).toBe('0.1167');
    expect(p.helpersNeeded).toBe('0.2333');
    expect(p.result).toBe('LOSS');
    expect(p.profitLoss).toBe('-2031.67');
  });

  it('work without a quantity or without a norm uses labour but is not measured', () => {
    expect(gangProductivity({ masons: 1, helpers: 2, norm: RFT }, rates)).toMatchObject({ labourCost: '3300.00', measured: false, result: 'NOT_MEASURED', profitLoss: '0.00' });
    expect(gangProductivity({ masons: 0, helpers: 1, doneQty: 9 }, rates)).toMatchObject({ labourCost: '1000.00', measured: false });
  });

  it('a helper-only norm is judged on helpers', () => {
    const p = gangProductivity({ masons: 0, helpers: 2, doneQty: 200, norm: n(50, 0, 1, 'Bags') }, rates);
    expect(p.outputPct).toBe('2.0000');
  });

  it('Kadara day totals: ₹27,100 labour, 120.55 % output, ₹2,917.50 profit', () => {
    const s = day([
      { masons: 1, helpers: 3, doneQty: 125, norm: RFT, unit: 'Rft' },
      { masons: 1, helpers: 2, doneQty: 65, norm: RFT, unit: 'Rft' },
      { masons: 1, helpers: 2, doneQty: 145, norm: RFT, unit: 'Rft' },
      { masons: 1, helpers: 2 },
      { masons: 1, helpers: 2, doneQty: 350, norm: PAINT, unit: 'Sq.ft' },
      { masons: 1, helpers: 1 },
      { masons: 1, helpers: 1 },
      { masons: 0, helpers: 5 },
    ]);
    expect(s).toEqual({
      masonDays: 7,
      helperDays: 18,
      labourCost: '27100.00',
      workDone: { Rft: '335.0000', 'Sq.ft': '350.0000' },
      masonsUsedMeasured: 4,
      helpersUsedMeasured: 9,
      masonsNeeded: '4.8083',
      helpersNeeded: '3.3500',
      outputPct: '1.2055',
      result: 'PROFIT',
      profitLoss: '2917.50',
    });
  });

  it('Ponram day totals: 34.06 % output, ₹6,066.67 loss', () => {
    const s = day([
      { masons: 1, helpers: 1, doneQty: 70, norm: BRICK, unit: 'Nos' },
      { masons: 1, helpers: 0, doneQty: 70, norm: BRICK, unit: 'Nos' },
      { masons: 1, helpers: 1, doneQty: 110, norm: BOARD, unit: 'Sq.ft' },
      { masons: 1, helpers: 2 },
      { masons: 1, helpers: 1 },
      { masons: 1, helpers: 2, doneQty: 110, norm: BRICK, unit: 'Nos' },
    ]);
    expect(s.labourCost).toBe('14800.00');
    expect(s.workDone).toEqual({ Nos: '250.0000', 'Sq.ft': '110.0000' });
    expect(s.outputPct).toBe('0.3406');
    expect(s.masonsNeeded).toBe('1.3333');
    expect(s.helpersNeeded).toBe('1.7500');
    expect(s.result).toBe('LOSS');
    expect(s.profitLoss).toBe('-6066.67');
  });

  it('defaults to one mason and the rest helpers', () => {
    expect(defaultCrewSplit(4)).toEqual({ masons: 1, helpers: 3 });
    expect(defaultCrewSplit(1)).toEqual({ masons: 1, helpers: 0 });
    expect(defaultCrewSplit(0)).toEqual({ masons: 0, helpers: 0 });
  });
});
