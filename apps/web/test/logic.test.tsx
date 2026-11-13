import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { plannedPctAt } from '../src/features/site/SitePages';
import { cell } from '../src/features/reports/ReportsPage';
import { api } from '../src/lib/api';
import { approveBlockedReason } from '../src/components/record/MatchCheck';

describe('plannedPctAt', () => {
  const a = { plannedStart: '2026-01-01', plannedFinish: '2026-01-11' };
  it('is linear between planned start and finish and clamped to 0–100', () => {
    expect(plannedPctAt(a, Date.UTC(2025, 11, 1))).toBe(0);
    expect(plannedPctAt(a, Date.UTC(2026, 0, 6))).toBeCloseTo(50);
    expect(plannedPctAt(a, Date.UTC(2026, 5, 1))).toBe(100);
  });
  it('returns null without planned dates', () => {
    expect(plannedPctAt({ plannedStart: null, plannedFinish: '2026-01-01' }, Date.now())).toBeNull();
  });
});

describe('report cell formatting', () => {
  it('formats money in Indian grouping and shows a dash for blanks', () => {
    render(<p>{cell('1234567.5', 'money', 'INR')}</p>);
    expect(screen.getByText('₹ 12,34,567.50')).toBeInTheDocument();
    render(<p data-testid="blank">{cell(null, 'money')}</p>);
    expect(screen.getByTestId('blank')).toHaveTextContent('—');
  });
});

describe('api.url', () => {
  it('drops empty parameters and encodes values', () => {
    expect(api.url('/projects/p1/reports/cvr', { format: 'pdf', from: '', to: undefined, q: 'a b' })).toBe('/api/projects/p1/reports/cvr?format=pdf&q=a+b');
  });
});

describe('purchase match check: approve button rule', () => {
  const base = { docType: 'PR' as const, number: 'RH-PR-0007', mode: 'ENFORCE' as const, tolerances: { ratePct: '0.02', qtyPct: '0.05' }, summary: '', lines: [], documentChecks: [], counts: { ok: 0, diff: 1, block: 0 }, attachments: 0 };
  it('lets everything that matches through, and anything in WARN mode', () => {
    expect(approveBlockedReason({ ...base, status: 'MATCH', approval: { allowed: true, needsReason: false, needsAttachment: false, message: '' } }, '')).toBeNull();
    expect(approveBlockedReason({ ...base, mode: 'WARN', status: 'BLOCKED', approval: { allowed: true, needsReason: false, needsAttachment: false, message: '' } }, '')).toBeNull();
  });
  it('blocks materials outside the BOM whatever the comment', () => {
    expect(approveBlockedReason({ ...base, status: 'BLOCKED', approval: { allowed: false, needsReason: false, needsAttachment: false, message: 'Materials outside the BOM cannot be approved.' } }, 'please approve')).toMatch(/outside the BOM/);
  });
  it('asks for a reason and an attachment for differences', () => {
    const m = { ...base, status: 'DIFF' as const, approval: { allowed: true, needsReason: true, needsAttachment: true, message: '' } };
    expect(approveBlockedReason(m, '')).toBe('To approve, add a reason (at least 5 characters) and a supporting document in the Attachments tab.');
    expect(approveBlockedReason(m, 'Consultant instruction')).toBe('To approve, add a supporting document in the Attachments tab.');
    expect(approveBlockedReason({ ...m, attachments: 1, approval: { ...m.approval, needsAttachment: false } }, 'Consultant instruction')).toBeNull();
  });
});
