import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MATERIAL_PRESETS } from '@toprock/shared';
import { SuggestInput, matchSuggestions, type Suggestion } from '../src/components/forms/SuggestInput';

const items: Suggestion[] = MATERIAL_PRESETS.map((m) => ({ value: m.name, hint: `${m.code} · ${m.unit} · ${m.category}` }));

describe('matchSuggestions', () => {
  it('finds by any order of words, puts names starting with the text first, and shows at most 8', () => {
    expect(matchSuggestions(items, 'tmt 12').map((s) => s.value)).toEqual(['TMT Bar Fe500D 12 mm']);
    expect(matchSuggestions(items, 'cement')[0].value.toLowerCase().startsWith('cement')).toBe(true);
    expect(matchSuggestions(items, 'e').length).toBe(8);
    expect(matchSuggestions(items, '')).toEqual([]);
    expect(matchSuggestions(items, 'cem-opc53').map((s) => s.value)).toEqual(['Cement OPC 53 Grade']);
  });
});

function Harness() {
  const [v, setV] = useState('');
  return (
    <>
      <SuggestInput id="n" items={items} value={v} onChange={setV} />
      <output data-testid="value">{v}</output>
    </>
  );
}

describe('SuggestInput', () => {
  it('shows nothing until you type, then a short list; Enter or click picks; own text is kept', async () => {
    render(<Harness />);
    const box = screen.getByRole('combobox');
    await userEvent.click(box);
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.type(box, 'm-sand');
    expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(8);
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('M-Sand (for concrete)');
    expect(screen.queryByRole('listbox')).toBeNull();

    await userEvent.clear(box);
    await userEvent.type(box, 'tmt 16');
    await userEvent.click(screen.getByRole('option', { name: /TMT Bar Fe500D 16 mm/ }));
    expect(screen.getByTestId('value').textContent).toBe('TMT Bar Fe500D 16 mm');

    await userEvent.clear(box);
    await userEvent.type(box, 'Roofing sheet (own)');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByTestId('value').textContent).toBe('Roofing sheet (own)');
  });
});
