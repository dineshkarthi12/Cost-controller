import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { plannedPctAt } from '../src/features/site/SitePages';
import { cell } from '../src/features/reports/ReportsPage';
import { api } from '../src/lib/api';

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
