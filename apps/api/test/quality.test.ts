/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import { day, prisma, setupWorld, type World } from './helpers.js';

let w: World;
let tpl: any;
let ins: any;
beforeAll(async () => {
  w = await setupWorld();
});

const item = (n: number) => ins.checklist.find((i: any) => i.lineNo === n);
const record = (n: number, result: string, remarks?: string, who: keyof World['c'] = 'se') =>
  w.c[who].put(`${w.P}/inspections/${ins.id}/checklist/${item(n).id}`, { result, remarks });
const reload = async () => (ins = await w.c.se.ok.get(`${w.P}/r/inspections/${ins.id}`));

describe('ITP / checklist templates', () => {
  it('quality staff create an organisation template; read-only roles cannot', async () => {
    tpl = await w.c.qa.ok.post('/org/r/checklistTemplates', {
      name: 'RCC slab — pre-pour',
      type: 'ITP',
      items: [
        { stage: 'Before work', description: 'Approved drawings available at site', pointType: 'REVIEW' },
        { stage: 'Before concreting', description: 'Reinforcement checked against BBS', acceptanceCriteria: 'Bar dia, spacing and cover as per drawing', reference: 'IS 456 cl. 26.4', pointType: 'HOLD' },
        { stage: 'During concreting', description: 'Slump test', acceptanceCriteria: '100 ± 25 mm', pointType: 'WITNESS' },
        { stage: 'After concreting', description: 'Curing started', pointType: 'REVIEW' },
      ],
    });
    const full = await w.c.se.ok.get(`/org/r/checklistTemplates/${tpl.id}`);
    expect(full.items.map((i: any) => [i.lineNo, i.pointType])).toEqual([[1, 'REVIEW'], [2, 'HOLD'], [3, 'WITNESS'], [4, 'REVIEW']]);
    expect((await w.c.auditor.post('/org/r/checklistTemplates', { name: 'X', type: 'ITP', items: [{ description: 'x', pointType: 'REVIEW' }] })).status).toBe(403);
    expect((await w.c.qa.post('/org/r/checklistTemplates', { name: 'Empty', type: 'ITP', items: [] })).status).toBe(422);
  });

  it('applies a template to an inspection, refusing inactive and foreign templates', async () => {
    ins = await w.c.se.ok.post(`${w.P}/r/inspections`, { type: 'ITP', title: 'Slab L3 pour', location: 'L3', requestedDate: day(0) });
    const inactive = await w.c.qa.ok.post('/org/r/checklistTemplates', { name: 'Old', type: 'ITP', active: false, items: [{ description: 'x', pointType: 'REVIEW' }] });
    expect((await w.c.se.post(`${w.P}/inspections/${ins.id}/checklist/template`, { templateId: inactive.id })).status).toBe(422);
    const other = await setupWorld();
    const foreign = await other.c.qa.ok.post('/org/r/checklistTemplates', { name: 'Foreign', type: 'ITP', items: [{ description: 'x', pointType: 'REVIEW' }] });
    expect((await w.c.se.post(`${w.P}/inspections/${ins.id}/checklist/template`, { templateId: foreign.id })).status).toBe(422);

    await w.c.se.ok.post(`${w.P}/inspections/${ins.id}/checklist/template`, { templateId: tpl.id });
    await reload();
    expect(ins.templateId).toBe(tpl.id);
    expect(ins.checklist).toHaveLength(4);
    expect(ins.checklist.every((i: any) => i.result === 'PENDING')).toBe(true);
    expect(item(2).acceptanceCriteria).toBe('Bar dia, spacing and cover as per drawing');
  });

  it('enforces hold points: later checks wait, and only quality approvers release them', async () => {
    expect((await record(1, 'PASS')).status).toBe(200);
    const blocked = await record(3, 'PASS');
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.message).toMatch(/Hold point 2/);
    expect((await record(2, 'PASS')).status).toBe(403); // site engineer has quality.manage but not quality.approve
    expect((await record(2, 'PASS', 'Cover blocks OK', 'qa')).status).toBe(200);
    await reload();
    expect(item(2).checkedById).toBe(w.users.qa.id);
    expect(ins.result).toBe('PENDING');
    expect(ins.status).toBe('OPEN');
  });

  it('a failed check fails the inspection, needs remarks, and cannot be overridden manually', async () => {
    expect((await record(3, 'FAIL')).status).toBe(422);
    expect((await record(3, 'FAIL', 'Slump 160 mm')).status).toBe(200);
    await reload();
    expect(ins.result).toBe('FAIL');
    expect(ins.status).toBe('INSPECTED');
    expect(ins.inspectorId).toBe(w.users.se.id);
    const pass = await w.c.se.patch(`${w.P}/r/inspections/${ins.id}`, { result: 'PASS' });
    expect(pass.status).toBe(422);
    expect((await w.c.se.patch(`${w.P}/r/inspections/${ins.id}`, { status: 'CLOSED' })).status).toBe(422);
    // A hold point cannot be reopened while later checks are recorded.
    expect((await record(2, 'PENDING', undefined, 'qa')).status).toBe(409);
  });

  it('raises one NCR from a failed check, pre-filled from the checklist', async () => {
    expect((await w.c.se.post(`${w.P}/inspections/${ins.id}/checklist/${item(1).id}/ncr`, { severity: 'MINOR' })).status).toBe(422);
    const ncr = await w.c.se.ok.post(`${w.P}/inspections/${ins.id}/checklist/${item(3).id}/ncr`, { severity: 'MAJOR' });
    expect(ncr.number).toBeTruthy();
    expect(ncr.inspectionId).toBe(ins.id);
    expect(ncr.description).toContain('Slump test');
    expect(ncr.description).toContain('100 ± 25 mm');
    expect(ncr.description).toContain('Slump 160 mm');
    expect((await w.c.se.post(`${w.P}/inspections/${ins.id}/checklist/${item(3).id}/ncr`, { severity: 'MAJOR' })).status).toBe(409);
    await reload();
    expect(item(3).ncrId).toBe(ncr.id);
    // The checklist can no longer be replaced once results exist.
    expect((await w.c.se.post(`${w.P}/inspections/${ins.id}/checklist/template`, { templateId: tpl.id })).status).toBe(409);
  });

  it('passes once every check is passed or not applicable, then closes and locks', async () => {
    expect((await record(3, 'NA')).status).toBe(409); // an NCR exists: re-inspect and pass instead
    expect((await record(3, 'PASS', 'Re-test after rework: 105 mm')).status).toBe(200);
    expect((await record(4, 'NA')).status).toBe(200);
    await reload();
    expect(ins.result).toBe('PASS');
    expect((await w.c.se.patch(`${w.P}/r/inspections/${ins.id}`, { result: 'FAIL' })).status).toBe(422);
    await w.c.se.ok.patch(`${w.P}/r/inspections/${ins.id}`, { result: 'CONDITIONAL', status: 'CLOSED' });
    expect((await record(4, 'PASS')).status).toBe(409);
    const actions = await prisma.auditEvent.findMany({ where: { entityId: ins.id }, select: { action: true } });
    expect(actions.filter((a) => a.action === 'CHECKLIST_RESULT').length).toBe(5);
    expect(actions.some((a) => a.action === 'NCR_RAISED')).toBe(true);
  });

  it('a template in use cannot be deleted', async () => {
    expect((await w.c.qa.del(`/org/r/checklistTemplates/${tpl.id}`)).status).toBe(409);
  });
});
