"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

const loginSchema = z.object({
  email: z.email("Informe um e-mail válido.").max(254),
  password: z.string().min(1, "Informe a senha.").max(200),
  next: z.string().optional(),
});

export type LoginState = { error?: string; fieldErrors?: Partial<Record<"email" | "password", string>> };

/** Só permite redirecionar para dentro do painel (evita open redirect). */
function safeNext(next?: string) {
  return next && /^\/(admin|onboarding)(\/[\w\-/]*)?$/.test(next) ? next : "/admin";
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!isSupabaseConfigured()) {
    return { error: "O banco de dados ainda não foi configurado neste ambiente." };
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors: LoginState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as "email" | "password";
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Mensagem genérica: não revela se o e-mail existe.
    if (error.status === 429) return { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
    return { error: "E-mail ou senha incorretos." };
  }

  redirect(safeNext(parsed.data.next));
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
