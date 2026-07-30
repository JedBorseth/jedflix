import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/** Fresh QueryClient per test so catalog cache never leaks across cases. */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function withQueryClient(children: ReactNode, client = createTestQueryClient()) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
