import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireMembership, requireRole, type RoleKey } from "@/lib/auth/dal";
import { dbErrorMessage, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { anonymizeSchema, customerSchema, supplierSchema } from "./schemas";

/** Quem atende cadastra e edita clientes. */
export const CUSTOMER_ROLES: RoleKey[] = ["owner", "admin", "manager", "operator"];
/** Anonimização e exportação de dados pessoais (LGPD). */
export const PRIVACY_ROLES: RoleKey[] = ["owner", "admin"];
export const SUPPLIER_ROLES: RoleKey[] = ["owner", "admin", "manager"];

export const canEditCustomers = (role: RoleKey) => CUSTOMER_ROLES.includes(role);
export const canHandlePrivacy = (role: RoleKey) => PRIVACY_ROLES.includes(role);
export const canEditSuppliers = (role: RoleKey) => SUPPLIER_ROLES.includes(role);

const PAGE_SIZE = 50;
export const PARTNERS_PAGE_SIZE = PAGE_SIZE;

const cleanQuery = (q?: string) => (q ?? "").replace(/[%,()*]/g, " ").trim();

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------
export type Customer = {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  postal_code: string | null;
  street: string | null;
  address_number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  marketing_opt_in: boolean;
  marketing_opt_in_at: string | null;
  whatsapp_opt_in: boolean;
  whatsapp_opt_in_at: string | null;
  status: "active" | "inactive";
  anonymized_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Consent = { id: string; channel: "marketing" | "whatsapp"; granted: boolean; source: string; created_at: string; recorded_by: string | null };

export async function listCustomers(filters: { q?: string; status?: string; page?: number }) {
  await requireMembership();
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  let query = supabase
    .from("customers")
    .select("id, name, document, email, phone, city, state, status, whatsapp_opt_in, marketing_opt_in, anonymized_at", { count: "exact" })
    .order("name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (filters.status === "inactive") query = query.eq("status", "inactive");
  else if (filters.status !== "all") query = query.eq("status", "active");
  const q = cleanQuery(filters.q);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const parts = [`name.ilike.%${q}%`, `email.ilike.%${q}%`];
    if (digits.length >= 4) parts.push(`document.like.%${digits}%`, `phone.like.%${digits}%`);
    query = query.or(parts.join(","));
  }
  const { data, error, count } = await query;
  if (error) throw new Error("Não foi possível carregar os clientes.");
  return { rows: data as Pick<Customer, "id" | "name" | "document" | "email" | "phone" | "city" | "state" | "status" | "whatsapp_opt_in" | "marketing_opt_in" | "anonymized_at">[], total: count ?? 0, page };
}

export async function getCustomer(id: string) {
  await requireMembership();
  const supabase = await createClient();
  const [{ data: customer }, { data: consents }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).maybeSingle(),
    supabase.from("customer_consents").select("id, channel, granted, source, created_at, recorded_by").eq("customer_id", id).order("created_at", { ascending: false }),
  ]);
  if (!customer) return null;
  const rows = (consents ?? []) as Consent[];
  const ids = [...new Set(rows.map((c) => c.recorded_by).filter(Boolean))] as string[];
  const people: Record<string, string> = {};
  if (ids.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of profiles ?? []) if (p.full_name) people[p.id as string] = p.full_name as string;
  }
  return { customer: customer as Customer, consents: rows, people };
}

export async function saveCustomer(id: string | null, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const { companyId, user } = await requireRole(CUSTOMER_ROLES);
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("customers").update(parsed.data).eq("id", id);
    if (error) return { ok: false, error: customerError(error) };
    return { ok: true, message: "Cliente salvo.", data: { id } };
  }
  const { data, error } = await supabase
    .from("customers")
    .insert({ ...parsed.data, company_id: companyId, created_by: user.id })
    .select("id")
    .single();
  if (error) return { ok: false, error: customerError(error) };
  return { ok: true, message: "Cliente cadastrado.", data: { id: data.id as string } };
}

function customerError(error: { code?: string; message?: string; details?: string }) {
  if (error.code === "23505" && `${error.message}${error.details}`.includes("customers_document_uq")) return "Já existe um cliente com este CPF/CNPJ.";
  return dbErrorMessage(error);
}

export async function anonymizeCustomer(input: Record<string, unknown>): Promise<ActionResult> {
  await requireRole(PRIVACY_ROLES);
  const parsed = anonymizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_anonymize_customer", { p_customer_id: parsed.data.customer_id, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Dados pessoais removidos. O registro continua apenas para o histórico." };
}

/**
 * Exportação dos dados do titular (LGPD, art. 18). Registra o acesso na auditoria.
 * Pedidos e compras do cliente entram na exportação quando existirem (Fase 5).
 */
export async function exportCustomer(id: string) {
  const { companyId, user } = await requireRole(PRIVACY_ROLES);
  const data = await getCustomer(id);
  if (!data) return null;
  const supabase = await createClient();
  // Sem registro na auditoria, não exporta.
  const { error } = await supabase.rpc("fn_log_customer_export", { p_customer_id: id });
  if (error) throw new Error("Não foi possível registrar a exportação.");
  const { customer, consents } = data;
  return {
    gerado_em: new Date().toISOString(),
    empresa_id: companyId,
    solicitado_por: user.email,
    cliente: customer,
    consentimentos: consents.map(({ channel, granted, source, created_at }) => ({ canal: channel, concedido: granted, origem: source, em: created_at })),
  };
}

// ---------------------------------------------------------------------------
// Fornecedores
// ---------------------------------------------------------------------------
export type Supplier = {
  id: string;
  name: string;
  trade_name: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  contact_name: string | null;
  postal_code: string | null;
  street: string | null;
  address_number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  status: "active" | "inactive";
};

export async function listSuppliers(filters: { q?: string; status?: string }) {
  await requireMembership();
  const supabase = await createClient();
  let query = supabase.from("suppliers").select("id, name, trade_name, document, phone, email, contact_name, city, state, status").order("name").limit(500);
  if (filters.status === "inactive") query = query.eq("status", "inactive");
  else if (filters.status !== "all") query = query.eq("status", "active");
  const q = cleanQuery(filters.q);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const parts = [`name.ilike.%${q}%`, `trade_name.ilike.%${q}%`];
    if (digits.length >= 4) parts.push(`document.like.%${digits}%`);
    query = query.or(parts.join(","));
  }
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar os fornecedores.");
  return data as Pick<Supplier, "id" | "name" | "trade_name" | "document" | "phone" | "email" | "contact_name" | "city" | "state" | "status">[];
}

export async function listSupplierOptions() {
  await requireMembership();
  const supabase = await createClient();
  const { data } = await supabase.from("suppliers").select("id, name, trade_name, status").order("name");
  return (data ?? []) as { id: string; name: string; trade_name: string | null; status: string }[];
}

export async function getSupplier(id: string) {
  await requireMembership();
  const supabase = await createClient();
  const [{ data: supplier }, { data: materials }] = await Promise.all([
    supabase.from("suppliers").select("*").eq("id", id).maybeSingle(),
    supabase.from("raw_materials").select("id, name, code, status").eq("preferred_supplier_id", id).order("name"),
  ]);
  if (!supplier) return null;
  return { supplier: supplier as Supplier, materials: (materials ?? []) as { id: string; name: string; code: string | null; status: string }[] };
}

export async function saveSupplier(id: string | null, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const { companyId, user } = await requireRole(SUPPLIER_ROLES);
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const dup = (error: { code?: string; message?: string; details?: string }) =>
    error.code === "23505" && `${error.message}${error.details}`.includes("suppliers_document_uq") ? "Já existe um fornecedor com este CPF/CNPJ." : dbErrorMessage(error);
  if (id) {
    const { error } = await supabase.from("suppliers").update(parsed.data).eq("id", id);
    if (error) return { ok: false, error: dup(error) };
    return { ok: true, message: "Fornecedor salvo.", data: { id } };
  }
  const { data, error } = await supabase
    .from("suppliers")
    .insert({ ...parsed.data, company_id: companyId, created_by: user.id })
    .select("id")
    .single();
  if (error) return { ok: false, error: dup(error) };
  return { ok: true, message: "Fornecedor cadastrado.", data: { id: data.id as string } };
}
