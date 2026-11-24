/**
 * Variáveis públicas precisam ser lidas literalmente (process.env.NEXT_PUBLIC_X)
 * para que o Next.js as injete no bundle do navegador.
 */
export function getPublicSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export function isSupabaseConfigured() {
  return getPublicSupabaseEnv() !== null;
}

export function requirePublicSupabaseEnv() {
  const env = getPublicSupabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (veja .env.example).",
    );
  }
  return env;
}

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";
