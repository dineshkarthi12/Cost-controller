import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setUnauthorizedHandler } from './api';

export interface MeProject {
  id: string;
  code: string;
  name: string;
  status: string;
  currency: string;
  isDemo: boolean;
  location: string | null;
}

export interface Me {
  user: { id: string; name: string; email: string; designation: string | null; department: string | null; mfaEnabled: boolean; employeeId: string | null };
  org: { id: string; name: string; code: string; baseCurrency: string; isDemo: boolean };
  projects: MeProject[];
  permissions: string[];
  roles: string[];
  visibleModules: string[];
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  project: MeProject | null;
  projectId: string | null;
  setProjectId: (id: string) => void;
  can: (perm: string | null | undefined) => boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const KEY = 'tr.project';

function readStored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [projectId, setProjectIdState] = useState<string | null>(readStored());
  const meQuery = useQuery({
    queryKey: ['me', projectId],
    queryFn: () => api.get<Me>('/auth/me', { projectId: projectId ?? undefined }),
    retry: false,
    staleTime: 60_000,
  });
  const me = meQuery.isError ? null : (meQuery.data ?? null);

  useEffect(() => {
    if (!me) return;
    if (!projectId || !me.projects.some((p) => p.id === projectId)) {
      const first = me.projects[0]?.id ?? null;
      if (first !== projectId) setProjectIdState(first);
    }
  }, [me, projectId]);

  const setProjectId = useCallback(
    (id: string) => {
      try {
        localStorage.setItem(KEY, id);
      } catch {
        /* storage unavailable */
      }
      setProjectIdState(id);
      // Project-scoped data must never leak between projects in the cache.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] === 'p' });
    },
    [qc],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(['me', projectId], undefined);
      void qc.invalidateQueries({ queryKey: ['me'] });
    });
  }, [qc, projectId]);

  const value = useMemo<AuthState>(() => {
    const perms = new Set(me?.permissions ?? []);
    return {
      me,
      loading: meQuery.isLoading,
      project: me?.projects.find((p) => p.id === projectId) ?? null,
      projectId: me?.projects.some((p) => p.id === projectId) ? projectId : null,
      setProjectId,
      can: (perm) => !perm || perms.has(perm),
      refresh: () => meQuery.refetch(),
      logout: async () => {
        await api.post('/auth/logout').catch(() => undefined);
        qc.clear();
        window.location.href = '/login';
      },
    };
  }, [me, meQuery, projectId, setProjectId, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

/** Current project id — pages under the shell can rely on it being set. */
export function useProjectId(): string {
  const { projectId } = useAuth();
  return projectId ?? '';
}
