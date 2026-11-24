"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requirePublicSupabaseEnv } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient> | undefined;

/** Cliente do navegador (publishable key + sessão do usuário; sujeito a RLS). */
export function createClient() {
  if (!client) {
    const { url, key } = requirePublicSupabaseEnv();
    client = createBrowserClient(url, key);
  }
  return client;
}
