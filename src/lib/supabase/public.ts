import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requirePublicSupabaseEnv } from "@/lib/env";

/**
 * Cliente anônimo SEM cookies, para leituras públicas da loja (funções
 * store_*). Não depende da requisição, então pode ser usado em "use cache".
 */
export function createPublicClient() {
  const { url, key } = requirePublicSupabaseEnv();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
