import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type RoleKey = "owner" | "admin" | "manager" | "operator" | "viewer";

export type CurrentUser = {
  id: string;
  email: string | null;
  fullName: string | null;
};

export type Membership = {
  user: CurrentUser;
  companyId: string;
  companyName: string;
  role: RoleKey;
};

/** Usuário autenticado (JWT validado) ou null. Deduplicado por requisição. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", data.claims.sub)
    .maybeSingle();

  return {
    id: data.claims.sub,
    email: (data.claims.email as string | undefined) ?? null,
    fullName: profile?.full_name ?? null,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Vínculo ativo do usuário com uma empresa (versão 1: no máximo um). */
export const getMembership = cache(async (): Promise<Membership | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("company_members")
    .select("company_id, status, roles(key), companies(name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const role = (data.roles as unknown as { key: RoleKey } | null)?.key;
  const company = data.companies as unknown as { name: string } | null;
  if (!role || !company) return null;

  return { user, companyId: data.company_id, companyName: company.name, role };
});

/** Exige usuário com empresa; sem empresa vai para o onboarding. */
export async function requireMembership(): Promise<Membership> {
  await requireUser();
  const membership = await getMembership();
  if (!membership) redirect("/onboarding");
  return membership;
}

export async function requireRole(roles: RoleKey[]): Promise<Membership> {
  const membership = await requireMembership();
  if (!roles.includes(membership.role)) {
    throw new Error("Permissão insuficiente para esta operação.");
  }
  return membership;
}
