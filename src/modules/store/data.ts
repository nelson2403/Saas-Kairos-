import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/env";
import type { StoreProductCard, StoreProductDetail, StoreSettings } from "./domain";

/**
 * Leituras públicas da loja (cache curto, invalidado pela tag "store" quando
 * produtos, fotos ou configurações mudam). A disponibilidade final é sempre
 * conferida no carrinho e no checkout.
 */
export const STORE_TAG = "store";
export const PAGE_SIZE = 24;

const num = (v: unknown) => Number(v ?? 0);

export async function getStoreSettings(): Promise<StoreSettings | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(STORE_TAG);
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await createPublicClient().rpc("store_settings");
  if (error || !data) return null;
  const s = data as Record<string, unknown>;
  return {
    company_name: String(s.company_name ?? "Kairós"),
    enabled: s.enabled === true,
    whatsapp: (s.whatsapp as string | null) ?? null,
    pickup_enabled: s.pickup_enabled === true,
    pickup_address: (s.pickup_address as string | null) ?? null,
    delivery_enabled: s.delivery_enabled === true,
    delivery_fee: num(s.delivery_fee),
    delivery_notes: (s.delivery_notes as string | null) ?? null,
    payment_instructions: String(s.payment_instructions ?? ""),
    reservation_hours: num(s.reservation_hours) || 48,
  };
}

export async function getStoreCategories() {
  "use cache";
  cacheLife("minutes");
  cacheTag(STORE_TAG);
  if (!isSupabaseConfigured()) return [];
  const { data } = await createPublicClient().rpc("store_categories");
  return (data ?? []) as { id: string; name: string; parent_id: string | null; products: number }[];
}

export async function getStoreProducts(opts: { category?: string | null; q?: string | null; page?: number } = {}) {
  "use cache";
  cacheLife("minutes");
  cacheTag(STORE_TAG);
  const page = Math.max(1, opts.page ?? 1);
  if (!isSupabaseConfigured()) return { products: [] as StoreProductCard[], total: 0, page };
  const { data, error } = await createPublicClient().rpc("store_products", {
    p_category: opts.category || null,
    p_search: opts.q || null,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  if (error) {
    // Sem a migration da loja ou banco indisponível: a loja aparece como "em breve", sem derrubar a página.
    console.error("store_products falhou:", error.code);
    return { products: [] as StoreProductCard[], total: 0, page };
  }
  const rows = (data ?? []) as (StoreProductCard & { total: number })[];
  return {
    products: rows.map((r) => ({ ...r, price: num(r.price), available: num(r.available) })) as StoreProductCard[],
    total: rows.length ? num(rows[0].total) : 0,
    page,
  };
}

export async function getStoreProduct(slug: string): Promise<StoreProductDetail | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(STORE_TAG);
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await createPublicClient().rpc("store_product", { p_slug: slug });
  if (error || !data) return null;
  const p = data as StoreProductDetail;
  return { ...p, price: num(p.price), available: num(p.available) };
}

/** Todos os slugs públicos (sitemap). */
export async function getAllStoreSlugs() {
  "use cache";
  cacheLife("hours");
  cacheTag(STORE_TAG);
  if (!isSupabaseConfigured()) return [];
  const out: { slug: string }[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const { data } = await createPublicClient().rpc("store_products", { p_limit: 100, p_offset: offset });
    const rows = (data ?? []) as { slug: string }[];
    out.push(...rows.map((r) => ({ slug: r.slug })));
    if (rows.length < 100) break;
  }
  return out;
}
