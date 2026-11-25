import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireMembership, requireRole } from "@/lib/auth/dal";
import { companySchema, onboardingSchema } from "./schemas";

export type ActionResult = { ok: true; message?: string } | { ok: false; error?: string; fieldErrors?: Record<string, string> };

function toFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

export async function getCompany() {
  const { companyId, role } = await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, legal_name, document, email, phone, timezone, currency, updated_at")
    .eq("id", companyId)
    .single();
  if (error) throw new Error("Não foi possível carregar os dados da empresa.");
  return { company: data, canEdit: role === "owner" || role === "admin" };
}

export async function updateCompany(input: Record<string, unknown>): Promise<ActionResult> {
  const { companyId } = await requireRole(["owner", "admin"]);
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("companies")
    .update(parsed.data, { count: "exact" })
    .eq("id", companyId);
  if (error || count === 0) return { ok: false, error: "Não foi possível salvar. Tente novamente." };
  return { ok: true, message: "Dados da empresa salvos." };
}

export async function createCompany(input: Record<string, unknown>): Promise<ActionResult & { companyId?: string }> {
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_company_with_owner", {
    p_name: parsed.data.name,
    p_document: parsed.data.document,
  });
  if (error) {
    if (error.message.includes("já vinculado")) return { ok: false, error: "Seu usuário já está vinculado a uma empresa." };
    if (error.message.includes("já configurada")) return { ok: false, error: "O sistema já foi configurado. Peça ao administrador para liberar seu acesso." };
    return { ok: false, error: "Não foi possível criar a empresa." };
  }
  return { ok: true, companyId: data as string };
}
