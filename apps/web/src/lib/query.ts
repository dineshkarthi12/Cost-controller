import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(err.status)) && count < 2,
    },
    mutations: { retry: false },
  },
});
