import { describe, expect, it } from 'vitest';
import { boqSheetRows } from '../src/index.js';

const item = (itemCode: string, description: string, section: string | null, specification: string | null, qty: number, rate: number) => ({ id: itemCode, itemCode, description, section, specification, unit: 'Nos', contractQty: qty, unitRate: rate });

describe('BOQ laid out like the Excel', () => {
  it('sections, item headings, a/b lines and section totals, in the given order', () => {
    const rows = boqSheetRows([
      item('1.01.a', 'Site Mobilisation & Protection – Location: whole area', 'PRELIMINARIES', 'Site Mobilisation & Protection:- Allow cost for site mobilisation', 1, 34945),
      item('1.02.a', 'Project Management – Location: whole area', 'PRELIMINARIES', 'Project Management:- Allow cost', 1, 75265),
      item('3.01.a', 'Gypsum Cladding – Location: AI Lab side', 'PARTITIONS', 'Gypsum Cladding:- Supply', 294.9, 135),
      item('3.01.b', 'Gypsum Cladding – Location: Space Room', 'PARTITIONS', 'Gypsum Cladding:- Supply', 272, 135),
      item('10.01.a', 'Split AC – Location: Mojomix', 'HVAC WORKS', 'Split AC:- Supply', 5, 55730),
    ]);
    expect(rows.map((r) => (r.kind === 'SECTION' ? `S ${r.no} ${r.title}` : r.kind === 'HEADING' ? `H ${r.code} ${r.title}` : r.kind === 'ITEM' ? `I ${r.code} ${r.text} ${r.amount}` : r.kind === 'TOTAL' ? `T ${r.amount}` : `G ${r.amount} ${r.items}`))).toEqual([
      'S 1 PRELIMINARIES',
      'H 1.01 Site Mobilisation & Protection',
      'I a Location: whole area 34945.00',
      'H 1.02 Project Management',
      'I a Location: whole area 75265.00',
      'T 110210.00',
      'S 3 PARTITIONS',
      'H 3.01 Gypsum Cladding',
      'I a Location: AI Lab side 39811.50',
      'I b Location: Space Room 36720.00',
      'T 76531.50',
      'S 10 HVAC WORKS',
      'H 10.01 Split AC',
      'I a Location: Mojomix 278650.00',
      'T 278650.00',
      'G 465391.50 5',
    ]);
    const h = rows[1];
    expect(h.kind === 'HEADING' && h.text).toBe('Site Mobilisation & Protection:- Allow cost for site mobilisation');
  });

  it('a flat BOQ (no sections or headings) is just the items and the grand total', () => {
    const rows = boqSheetRows([item('C-1', 'Excavation', null, null, 100, 450), item('C-2', 'PCC', null, null, 10, 6200)]);
    expect(rows.map((r) => r.kind)).toEqual(['ITEM', 'ITEM', 'GRAND_TOTAL']);
    expect(rows[0].kind === 'ITEM' && rows[0].code).toBe('C-1');
  });
});

import { whatsappNumber, whatsappUrl } from '../src/index.js';
describe('WhatsApp links', () => {
  it('normalises Indian numbers and encodes the message', () => {
    expect(whatsappNumber('+91 89407 42959')).toBe('918940742959');
    expect(whatsappNumber('089407 42959')).toBe('918940742959');
    expect(whatsappNumber('8940742959')).toBe('918940742959');
    expect(whatsappUrl('+91 89407 42959', '*DPR* 2 Nov & more')).toBe('https://wa.me/918940742959?text=*DPR*%202%20Nov%20%26%20more');
    expect(whatsappUrl(null, 'x')).toBe('https://wa.me/?text=x');
    expect(decodeURIComponent(whatsappUrl('8940742959', 'a'.repeat(5000)).split('text=')[1]).length).toBeLessThanOrEqual(3500);
  });
});
