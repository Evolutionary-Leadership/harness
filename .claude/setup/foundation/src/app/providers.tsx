"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ToastProvider } from "@/components/toast";

/**
 * One QueryClient per browser session, created inside useState so it is not
 * shared between requests during server rendering.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Initial page data is seeded from the Server Component under the same
        // key the client would have fetched into, so an immediate refetch on
        // mount would be a wasted round trip with nothing new in it.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        // Optimistic mutations must NOT retry by default: a retry would replay
        // onMutate's patch on top of an already-patched cache.
        retry: 0,
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
