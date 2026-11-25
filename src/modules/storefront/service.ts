import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/env";
import { requireMembership, requireRole, type RoleKey } from "@/lib/auth/dal";
import { dbErrorMessage, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { STORE_TAG } from "@/modules/store/data";
import { DEFAULT_STOREFRONT, readStorefront, storefrontSchema, type Storefront } from "./schema";

export const canCustomizeStore = (role: RoleKey) => role === "owner" || role === "admin";

/** Versão PUBLICADA (loja pública). Sem publicação ainda: aparência padrão. */
export async function getPublishedStorefront(): Promise<Storefront> {
  "use cache";
  cacheLife("minutes");
  cacheTag(STORE_TAG);
  if (!isSupabaseConfigured()) return DEFAULT_STOREFRONT;
  const { data, error } = await createPublicClient().rpc("store_theme");
  if (error || !data) return DEFAULT_STOREFRONT;
  return readStorefront(data);
}

export type StorefrontVersion = { version: number; note: string | null; published_at: string; published_by: string | null };

export async function getEditorData() {
  const { role, companyId } = await requireMembership();
  const supabase = await createClient();
  const [{ data: row }, { data: versions }, { data: categories }] = await Promise.all([
    supabase.from("storefront").select("draft, draft_updated_at, published_version, published_at").eq("company_id", companyId).maybeSingle(),
    supabase.from("storefront_versions").select("version, note, published_at, published_by").order("version", { ascending: false }).limit(50),
    supabase.from("product_categories").select("id, name").eq("active", true).order("name"),
  ]);
  const list = (versions ?? []) as StorefrontVersion[];
  const ids = [...new Set(list.map((v) => v.published_by).filter(Boolean))] as string[];
  const people: Record<string, string> = {};
  if (ids.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of profiles ?? []) if (p.full_name) people[p.id as string] = p.full_name as string;
  }
  return {
    companyId,
    canEdit: canCustomizeStore(role),
    draft: row ? readStorefront(row.draft) : DEFAULT_STOREFRONT,
    hasDraft: !!row,
    draftUpdatedAt: (row?.draft_updated_at as string | undefined) ?? null,
    publishedVersion: (row?.published_version as number | null) ?? null,
    publishedAt: (row?.published_at as string | null) ?? null,
    versions: list,
    people,
    categories: (categories ?? []) as { id: string; name: string }[],
  };
}

/** Rascunho para a prévia (somente equipe logada). */
export async function getDraftStorefront(): Promise<Storefront> {
  const { companyId } = await requireMembership();
  const supabase = await createClient();
  const { data } = await supabase.from("storefront").select("draft").eq("company_id", companyId).maybeSingle();
  return data ? readStorefront(data.draft) : DEFAULT_STOREFRONT;
}

export async function saveDraft(input: unknown): Promise<ActionResult<{ savedAt: string }>> {
  await requireRole(["owner", "admin"]);
  const parsed = storefrontSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `Revise: ${first?.message ?? "configuração inválida"}`, fieldErrors: toFieldErrors(parsed.error.issues) };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_save_storefront_draft", { p_draft: parsed.data });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Rascunho salvo.", data: { savedAt: data as string } };
}

export async function publishStorefront(note: string): Promise<ActionResult<{ version: number }>> {
  await requireRole(["owner", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_publish_storefront", { p_note: note.trim().slice(0, 200) || null });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: `Publicado (versão ${data}). A loja já mostra a nova aparência.`, data: { version: data as number } };
}

export async function restoreVersion(version: number): Promise<ActionResult> {
  await requireRole(["owner", "admin"]);
  if (!Number.isInteger(version) || version < 1) return { ok: false, error: "Versão inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_restore_storefront_version", { p_version: version });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: `Versão ${version} copiada para o rascunho. Revise e publique quando quiser.` };
}
