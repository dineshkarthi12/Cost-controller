/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import { approvedPo, setupWorld, type World } from './helpers.js';

/**
 * Every report a cost control lead and an administrator can open: numeric columns (money, qty, pct, int)
 * hold numbers or nothing, never formatted text — the report screen formats them, and text there used to
 * crash the page ("Project profitability": "7.13%").
 */
let w: World;
beforeAll(async () => {
  w = await setupWorld();
  await approvedPo(w, { qty: '100', rate: '400' });
});

describe('report column types', () => {
  it('numeric columns carry numbers in every report', async () => {
    const { reports } = await w.c.admin.ok.get(`${w.P}/reports`);
    expect(reports.length).toBeGreaterThan(20);
    const problems: string[] = [];
    for (const r of reports) {
      const res = await w.c.admin.get(`${w.P}/reports/${r.key}`);
      if (res.status !== 200) {
        problems.push(`${r.key}: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
        continue;
      }
      const numeric = res.body.columns.filter((c: any) => ['money', 'qty', 'pct', 'int'].includes(c.type));
      for (const row of res.body.rows) for (const c of numeric) {
        const v = row[c.key];
        if (v === null || v === undefined || v === '') continue;
        if (!/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(String(v).trim())) problems.push(`${r.key}.${c.key} = ${JSON.stringify(v)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('project profitability gives the margin share as a fraction', async () => {
    const r = await w.c.admin.ok.get(`${w.P}/reports/project-profitability`);
    const margin = r.rows.find((x: any) => x.item === 'Projected margin');
    expect(r.columns.find((c: any) => c.key === 'share').type).toBe('pct');
    expect(Number(margin.share)).toBeGreaterThan(-1);
    expect(r.rows.some((x: any) => String(x.amount).includes('%'))).toBe(false);
  });
});
