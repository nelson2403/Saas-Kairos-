import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requirePublicSupabaseEnv } from "@/lib/env";

/**
 * Cliente com a SECRET KEY: ignora RLS. Uso restrito a serviços do servidor que
 * já verificaram autorização (webhooks, filas, credenciais de integrações).
 * O import de "server-only" faz o build falhar se um componente cliente o importar.
 */
export function createAdminClient() {
  const { url } = requirePublicSupabaseEnv();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SECRET_KEY não definida no servidor.");
  }
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
