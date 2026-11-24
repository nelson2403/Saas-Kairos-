import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { requirePublicSupabaseEnv } from "@/lib/env";

/**
 * Cliente Supabase do usuário atual (respeita RLS).
 * Lê cookies, portanto só pode ser usado dentro de <Suspense>, Server Actions ou Route Handlers.
 */
export async function createClient() {
  // cookies() primeiro: marca o trecho como dinâmico (por requisição) antes de
  // qualquer outra verificação, para que nunca seja executado no prerender.
  const cookieStore = await cookies();
  const { url, key } = requirePublicSupabaseEnv();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Chamado a partir de um Server Component: a renovação de sessão
          // acontece no proxy.ts, então pode ser ignorado com segurança.
        }
      },
    },
  });
}
