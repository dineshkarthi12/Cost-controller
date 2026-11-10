import { describe, expect, it } from 'vitest';
import { matchMaterial, normalizeUnit, unitFactor } from '../src/calc/units';
import { MATERIAL_PRESETS } from '../src/catalogues/materials';

describe('units', () => {
  it('reads units as written on site', () => {
    expect(normalizeUnit('Sq.ft')?.code).toBe('SQFT');
    expect(normalizeUnit('Mtr')?.code).toBe('M');
    expect(normalizeUnit('RMT')?.code).toBe('M');
    expect(normalizeUnit('Bags')?.code).toBe('BAG');
    expect(normalizeUnit('Kgs')?.code).toBe('KG');
    expect(normalizeUnit('MT')?.code).toBe('MT');
    expect(normalizeUnit('Cu.m')?.code).toBe('CUM');
    expect(normalizeUnit('Nos.')?.code).toBe('NOS');
    expect(normalizeUnit('widgets')).toBeNull();
  });
  it('converts within a dimension and refuses across dimensions', () => {
    expect(unitFactor('Kg', 'MT')?.toString()).toBe('0.001');
    expect(unitFactor('MT', 'kg')?.toString()).toBe('1000');
    expect(unitFactor('Sqft', 'SQM')?.toFixed(6)).toBe('0.092903');
    expect(unitFactor('CFT', 'CUM')?.toFixed(6)).toBe('0.028317');
    expect(unitFactor('Rmt', 'M')?.toString()).toBe('1');
    expect(unitFactor('Bag', 'BAG')?.toString()).toBe('1');
    expect(unitFactor('Bag', 'KG')).toBeNull();
    expect(unitFactor('Nos', 'SQM')).toBeNull();
    expect(unitFactor('Lot X', 'Lot X')?.toString()).toBe('1');
    expect(unitFactor('Lot X', 'Lot Y')).toBeNull();
  });
});

describe('matchMaterial', () => {
  const mats = MATERIAL_PRESETS.map((m) => ({ id: m.code, code: m.code, name: m.name }));
  const m = (d: string) => matchMaterial(d, mats)?.code ?? null;
  it('matches exact names and codes', () => {
    expect(m('cement opc 53 grade')).toBe('CEM-OPC53');
    expect(m('STL-TMT12')).toBe('STL-TMT12');
  });
  it('matches estimator wording with the same sizes', () => {
    expect(m('OPC 53 Grade Cement (50 kg bag)')).toBe('CEM-OPC53');
    expect(m('TMT steel 12mm')).toBe('STL-TMT12');
    expect(m('TMT 16 mm dia bars')).toBe('STL-TMT16');
    expect(m('Coarse aggregate 20mm')).toBe('AGG-20MM');
    expect(m('FR copper wire 2.5 sq mm')).toBe('ELE-WIRE2.5');
  });
  it('leaves vague or ambiguous lines unlinked', () => {
    expect(m('Cement')).toBeNull();
    expect(m('Sand')).toBeNull();
    expect(m('TMT steel')).toBeNull();
    expect(m('Spot light (supply)')).toBeNull();
    expect(m('Coarse aggregate')).toBeNull();
  });
});
