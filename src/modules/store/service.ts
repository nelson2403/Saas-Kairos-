import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/dal";
import { dbErrorMessage, toFieldErrors, type ActionResult } from "@/lib/action-result";
import type { StoreSettings } from "./domain";
import { checkoutSchema, storeSettingsSchema } from "./schemas";

/** Hash do IP (LGPD: o IP em si não é guardado). */
function clientKey(ip: string) {
  const salt = process.env.SUPABASE_SECRET_KEY?.slice(-16) ?? "kairos";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/** Cancela reservas vencidas da loja. Falha aqui não impede a operação principal. */
export async function expireReservations() {
  try {
    await createAdminClient().rpc("fn_expire_reservations");
  } catch {
    // sem chave secreta configurada ou falha temporária: o agendamento diário cobre
  }
}

export type QuoteLine = { id: string; slug: string; name: string; price: number; image_path: string | null; available: number };

/** Preços e disponibilidade atuais para o carrinho (sem cache). */
export async function quoteCart(ids: string[]): Promise<QuoteLine[]> {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/.test(id)).slice(0, 50);
  if (!valid.length) return [];
  await expireReservations();
  const { data, error } = await createPublicClient().rpc("store_quote", { p_product_ids: valid });
  if (error) throw new Error("Não foi possível atualizar o carrinho.");
  return ((data ?? []) as QuoteLine[]).map((l) => ({ ...l, price: Number(l.price), available: Number(l.available) }));
}

export type CheckoutResult =
  | { ok: true; token: string; number: number }
  | { ok: false; error?: string; fieldErrors?: Record<string, string> };

export async function placeOrder(input: unknown, ip: string): Promise<CheckoutResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const admin = createAdminClient();

  // até 8 tentativas de checkout a cada 10 minutos por origem
  const { data: allowed, error: rlError } = await admin.rpc("fn_rate_limit", {
    p_bucket: `checkout:${clientKey(ip)}`,
    p_max: 8,
    p_window_seconds: 600,
  });
  if (rlError) return { ok: false, error: "Não foi possível concluir agora. Tente novamente em instantes." };
  if (!allowed) return { ok: false, error: "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo." };

  await expireReservations();
  const { data, error } = await admin.rpc("fn_store_checkout", {
    p_idempotency_key: v.idempotency_key,
    p_customer: { name: v.name, email: v.email, phone: v.phone, document: v.document },
    p_items: v.items,
    p_delivery:
      v.method === "entrega"
        ? { method: v.method, postal_code: v.postal_code, street: v.street, address_number: v.address_number, complement: v.complement, district: v.district, city: v.city, state: v.state }
        : { method: v.method },
    p_consents: { whatsapp: v.whatsapp_opt_in, marketing: v.marketing_opt_in },
    p_notes: v.notes || null,
  });
  if (error) return { ok: false, error: dbErrorMessage(error, "Não foi possível concluir o pedido. Tente novamente.") };
  const r = data as { public_token: string; number: number };
  return { ok: true, token: r.public_token, number: r.number };
}

export type StoreOrderView = {
  number: number;
  status: string;
  created_at: string;
  paid_at: string | null;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  delivery_method: "retirada" | "entrega" | null;
  reserved_until: string | null;
  items: { name: string; quantity: number; unit_price: number; total: number; unit: string }[];
};

export async function getStoreOrder(token: string): Promise<StoreOrderView | null> {
  if (!/^[0-9a-f-]{36}$/.test(token)) return null;
  const { data } = await createPublicClient().rpc("store_order", { p_token: token });
  return (data as StoreOrderView | null) ?? null;
}

// ---------------------------------------------------------------------------
// Configuração da loja (painel)
// ---------------------------------------------------------------------------
export async function getStoreSettingsForAdmin(): Promise<{ settings: StoreSettings; canEdit: boolean }> {
  const { role } = await requireRole(["owner", "admin", "manager", "operator", "viewer"]);
  const supabase = await createClient();
  const { data } = await supabase.rpc("store_settings");
  const s = (data ?? {}) as StoreSettings;
  return { settings: { ...s, delivery_fee: Number(s.delivery_fee ?? 0), reservation_hours: Number(s.reservation_hours ?? 48) }, canEdit: role === "owner" || role === "admin" };
}

export async function saveStoreSettings(input: Record<string, unknown>): Promise<ActionResult> {
  const { companyId } = await requireRole(["owner", "admin"]);
  const parsed = storeSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  if (parsed.data.enabled && !parsed.data.pickup_enabled && !parsed.data.delivery_enabled) {
    return { ok: false, fieldErrors: { pickup_enabled: "Ative retirada ou entrega para abrir a loja." } };
  }
  const supabase = await createClient();
  const { data } = await supabase.from("companies").select("settings").eq("id", companyId).single();
  const settings = { ...((data?.settings ?? {}) as Record<string, unknown>), store: parsed.data };
  const { error } = await supabase.from("companies").update({ settings }).eq("id", companyId);
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: parsed.data.enabled ? "Loja aberta e configurações salvas." : "Configurações salvas. A loja está fechada para pedidos." };
}
