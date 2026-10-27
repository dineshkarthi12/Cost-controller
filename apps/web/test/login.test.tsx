import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { LoginPage } from '../src/features/auth/AuthPages';

function setup() {
  const router = createMemoryRouter([{ path: '/login', element: <LoginPage /> }, { path: '/', element: <p>Signed in home</p> }], { initialEntries: ['/login'] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('shows the server error and stays on the page when credentials are wrong', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }));
    vi.stubGlobal('fetch', fetchMock);
    setup();
    await userEvent.type(screen.getByLabelText(/Email/), 'someone@toprock.example');
    await userEvent.type(screen.getByLabelText(/Password/), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/login');
    expect(init.headers['X-Requested-With']).toBe('toprock');
    expect(init.credentials).toBe('include');
  });

  it('navigates home after a successful sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { mfaRequired: false })));
    setup();
    await userEvent.type(screen.getByLabelText(/Email/), 'someone@toprock.example');
    await userEvent.type(screen.getByLabelText(/Password/), 'right');
    await userEvent.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(await screen.findByText('Signed in home')).toBeInTheDocument();
  });
});
