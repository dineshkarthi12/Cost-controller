/** Thin fetch wrapper. All state-changing requests carry the CSRF header the API requires. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  /** Field errors from zod flatten(): { fieldErrors: { field: [msg] } } */
  get fieldErrors(): Record<string, string[]> {
    const d = this.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return d?.fieldErrors ?? {};
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

function qs(params?: Params) {
  if (!params) return '';
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, params?: Params): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs(params)}`, {
      method,
      credentials: 'include',
      headers: { 'X-Requested-With': 'toprock', ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network unavailable. Check your connection and try again.');
  }
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  if (res.status === 413) throw new ApiError(413, 'TOO_LARGE', 'This file is too large to upload (the server accepts about 4 MB per request). Reduce its size and try again.');
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? res.statusText, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, params?: Params) => request<T>('GET', path, undefined, params),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
  /** URL for downloads (PDF / exports) — same-origin cookie auth. */
  url: (path: string, params?: Params) => `/api${path}${qs(params)}`,
};

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
