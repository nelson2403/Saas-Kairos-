import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireMembership, requireRole, type RoleKey } from "@/lib/auth/dal";
import { dbErrorMessage, isConflict, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { slugify, type ItemType, type Unit } from "./domain";
import { PRODUCT_IMAGES_BUCKET, productImageFolder, productImageUrl, type ProductImage } from "./images";
import {
  categorySchema,
  movementSchema,
  productSchema,
  rawMaterialSchema,
  reversalSchema,
  unitSchema,
} from "./schemas";

export const CATALOG_ROLES: RoleKey[] = ["owner", "admin", "manager"];
export const STOCK_ROLES: RoleKey[] = ["owner", "admin", "manager", "operator"];

export const canManageCatalog = (role: RoleKey) => CATALOG_ROLES.includes(role);
export const canMoveStock = (role: RoleKey) => STOCK_ROLES.includes(role);

// ---------------------------------------------------------------------------
// Tipos de leitura
// ---------------------------------------------------------------------------
export type Category = { id: string; name: string; parent_id: string | null; active: boolean; sort_order: number };

export type Product = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  barcode: string | null;
  category_id: string | null;
  unit_id: string;
  sale_price: string;
  cost_price: string | null;
  min_stock: string;
  description: string | null;
  status: "active" | "inactive" | "archived";
  show_in_store: boolean;
  updated_at: string;
};

export type RawMaterial = {
  id: string;
  name: string;
  code: string | null;
  unit_id: string;
  density: string | null;
  min_stock: string;
  last_cost: string | null;
  preferred_supplier_id: string | null;
  notes: string | null;
  status: "active" | "inactive" | "archived";
  updated_at: string;
};

export type StockRow = {
  item_type: ItemType;
  item_id: string;
  name: string;
  code: string | null;
  status: string;
  unit_code: string;
  quantity: string;
  reserved_quantity: string;
  available_quantity: string;
  min_stock: string;
  avg_cost: string;
  below_min: boolean;
  balance_updated_at: string | null;
};

export type Movement = {
  id: string;
  type: string;
  quantity: string;
  input_quantity: string;
  balance_before: string;
  balance_after: string;
  unit_cost: string | null;
  reason: string | null;
  notes: string | null;
  source_type: string | null;
  source_id: string | null;
  reversal_of: string | null;
  created_at: string;
  created_by: string | null;
  product: { id: string; name: string; unit: { code: string } } | null;
  raw_material: { id: string; name: string; unit: { code: string } } | null;
  input_unit: { code: string };
};

export type MovableItem = {
  key: string; // "product:<id>" | "raw_material:<id>"
  type: ItemType;
  id: string;
  name: string;
  code: string | null;
  unitId: string;
  density: number | null;
  quantity: number;
};

// ---------------------------------------------------------------------------
// Unidades
// ---------------------------------------------------------------------------
export async function listUnits(): Promise<Unit[]> {
  await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("measurement_units")
    .select("id, code, name, dimension, factor_to_base, company_id")
    .order("dimension")
    .order("factor_to_base");
  if (error) throw new Error("Não foi possível carregar as unidades.");
  return data as Unit[];
}

export async function createUnit(input: Record<string, unknown>): Promise<ActionResult> {
  const { companyId } = await requireRole(CATALOG_ROLES);
  const parsed = unitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.from("measurement_units").insert({
    company_id: companyId,
    code: parsed.data.code,
    name: parsed.data.name,
    dimension: parsed.data.dimension,
    factor_to_base: parsed.data.factor,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Unidade criada." };
}

// ---------------------------------------------------------------------------
// Configurações de estoque
// ---------------------------------------------------------------------------
export async function getStockSettings() {
  const { companyId, role } = await requireMembership();
  const supabase = await createClient();
  const { data } = await supabase.from("companies").select("settings").eq("id", companyId).single();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  return { allowNegative: settings.allow_negative_stock === true, canEdit: role === "owner" || role === "admin" };
}

export async function saveStockSettings(allowNegative: boolean): Promise<ActionResult> {
  const { companyId } = await requireRole(["owner", "admin"]);
  const supabase = await createClient();
  const { data } = await supabase.from("companies").select("settings").eq("id", companyId).single();
  const settings = { ...((data?.settings ?? {}) as Record<string, unknown>), allow_negative_stock: allowNegative };
  const { error } = await supabase.from("companies").update({ settings }).eq("id", companyId);
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Preferências de estoque salvas." };
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------
export async function listCategories(): Promise<Category[]> {
  await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_categories")
    .select("id, name, parent_id, active, sort_order")
    .order("sort_order")
    .order("name");
  if (error) throw new Error("Não foi possível carregar as categorias.");
  return data as Category[];
}

/** Nome com o caminho da árvore ("Velas › Aromáticas"). */
export function categoryPaths(categories: Category[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path = (c: Category, depth = 0): string => {
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    return parent && depth < 10 ? `${path(parent, depth + 1)} › ${c.name}` : c.name;
  };
  return categories.map((c) => ({ ...c, path: path(c) })).sort((a, b) => a.path.localeCompare(b.path, "pt-BR"));
}

export async function saveCategory(id: string | null, input: Record<string, unknown>): Promise<ActionResult> {
  const { companyId } = await requireRole(CATALOG_ROLES);
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("product_categories").update(parsed.data).eq("id", id)
    : await supabase.from("product_categories").insert({ ...parsed.data, company_id: companyId });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: id ? "Categoria atualizada." : "Categoria criada." };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  await requireRole(CATALOG_ROLES);
  const supabase = await createClient();
  const { error, count } = await supabase.from("product_categories").delete({ count: "exact" }).eq("id", id);
  if (error || !count) return { ok: false, error: dbErrorMessage(error, "Não foi possível excluir a categoria.") };
  return { ok: true, message: "Categoria excluída. Produtos dela ficaram sem categoria." };
}

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------
export type ProductListItem = Product & {
  category: { name: string } | null;
  unit: { code: string };
  images: { storage_path: string; sort_order: number }[];
};

export async function listProducts(filters: { q?: string; status?: string; category?: string }) {
  await requireMembership();
  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select("*, category:product_categories(name), unit:measurement_units(code), images:product_images(storage_path, sort_order)")
    .order("name")
    .limit(500);
  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  else if (!filters.status) query = query.neq("status", "archived");
  if (filters.category) query = query.eq("category_id", filters.category);
  if (filters.q) {
    const q = filters.q.replace(/[%,()]/g, " ").trim();
    if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.eq.${q}`);
  }
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar os produtos.");
  return data as unknown as ProductListItem[];
}

export async function getProduct(id: string) {
  await requireMembership();
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  return data as Product | null;
}

export async function saveProduct(id: string | null, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const { companyId, user } = await requireRole(CATALOG_ROLES);
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();

  if (id) {
    const { error } = await supabase.from("products").update(parsed.data).eq("id", id);
    if (error) return { ok: false, error: dbErrorMessage(error) };
    return { ok: true, message: "Produto salvo.", data: { id } };
  }

  // Slug único: tenta o slug do nome e, se já existir, acrescenta um sufixo.
  const base = slugify(parsed.data.name) || "produto";
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await supabase
      .from("products")
      .insert({ ...parsed.data, slug, company_id: companyId, created_by: user.id })
      .select("id")
      .single();
    if (!error) return { ok: true, message: "Produto criado.", data: { id: data.id as string } };
    if (!(error.code === "23505" && error.message.includes("slug"))) return { ok: false, error: dbErrorMessage(error) };
  }
  return { ok: false, error: "Não foi possível gerar um endereço único para o produto." };
}

// ---------------------------------------------------------------------------
// Matérias-primas
// ---------------------------------------------------------------------------
export type RawMaterialListItem = RawMaterial & { unit: { code: string } };

export async function listRawMaterials(filters: { q?: string; status?: string }) {
  await requireMembership();
  const supabase = await createClient();
  let query = supabase.from("raw_materials").select("*, unit:measurement_units(code)").order("name").limit(500);
  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  else if (!filters.status) query = query.neq("status", "archived");
  if (filters.q) {
    const q = filters.q.replace(/[%,()]/g, " ").trim();
    if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar as matérias-primas.");
  return data as unknown as RawMaterialListItem[];
}

export async function getRawMaterial(id: string) {
  await requireMembership();
  const supabase = await createClient();
  const { data } = await supabase.from("raw_materials").select("*").eq("id", id).maybeSingle();
  return data as RawMaterial | null;
}

export async function saveRawMaterial(id: string | null, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const { companyId, user } = await requireRole(CATALOG_ROLES);
  const parsed = rawMaterialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("raw_materials").update(parsed.data).eq("id", id);
    if (error) return { ok: false, error: dbErrorMessage(error) };
    return { ok: true, message: "Matéria-prima salva.", data: { id } };
  }
  const { data, error } = await supabase
    .from("raw_materials")
    .insert({ ...parsed.data, company_id: companyId, created_by: user.id })
    .select("id")
    .single();
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Matéria-prima criada.", data: { id: data.id as string } };
}

// ---------------------------------------------------------------------------
// Saldos
// ---------------------------------------------------------------------------
export async function getStockOverview(filters: { type?: ItemType; belowMin?: boolean; q?: string }) {
  await requireMembership();
  const supabase = await createClient();
  let query = supabase.from("stock_overview").select("*").neq("status", "archived").order("name").limit(1000);
  if (filters.type) query = query.eq("item_type", filters.type);
  if (filters.belowMin) query = query.eq("below_min", true);
  if (filters.q) {
    const q = filters.q.replace(/[%,()]/g, " ").trim();
    if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar o estoque.");
  return data as StockRow[];
}

export async function countBelowMin() {
  await requireMembership();
  const supabase = await createClient();
  const { count } = await supabase
    .from("stock_overview")
    .select("item_id", { count: "exact", head: true })
    .eq("status", "active")
    .eq("below_min", true);
  return count ?? 0;
}

export async function getItemBalance(type: ItemType, id: string) {
  await requireMembership();
  const supabase = await createClient();
  const { data } = await supabase.from("stock_overview").select("*").eq("item_type", type).eq("item_id", id).maybeSingle();
  return data as StockRow | null;
}

/** Itens que podem ser movimentados (ativos e inativos; arquivados não). */
export async function listMovableItems(): Promise<MovableItem[]> {
  await requireMembership();
  const supabase = await createClient();
  const [products, raws, balances] = await Promise.all([
    supabase.from("products").select("id, name, sku, unit_id").neq("status", "archived").order("name"),
    supabase.from("raw_materials").select("id, name, code, unit_id, density").neq("status", "archived").order("name"),
    supabase.from("stock_balances").select("product_id, raw_material_id, quantity"),
  ]);
  const qty = new Map<string, number>();
  for (const b of balances.data ?? []) qty.set((b.product_id ?? b.raw_material_id) as string, Number(b.quantity));
  return [
    ...(products.data ?? []).map((p) => ({
      key: `product:${p.id}`,
      type: "product" as const,
      id: p.id as string,
      name: p.name as string,
      code: p.sku as string | null,
      unitId: p.unit_id as string,
      density: null,
      quantity: qty.get(p.id) ?? 0,
    })),
    ...(raws.data ?? []).map((r) => ({
      key: `raw_material:${r.id}`,
      type: "raw_material" as const,
      id: r.id as string,
      name: r.name as string,
      code: r.code as string | null,
      unitId: r.unit_id as string,
      density: r.density == null ? null : Number(r.density),
      quantity: qty.get(r.id) ?? 0,
    })),
  ];
}

// ---------------------------------------------------------------------------
// Movimentações
// ---------------------------------------------------------------------------
const MOVEMENT_SELECT =
  "id, type, quantity, input_quantity, balance_before, balance_after, unit_cost, reason, notes, source_type, source_id, reversal_of, created_at, created_by, " +
  "product:products(id, name, unit:measurement_units(code)), raw_material:raw_materials(id, name, unit:measurement_units(code)), " +
  "input_unit:measurement_units(code)";

export const MOVEMENTS_PAGE_SIZE = 50;

export async function listMovements(filters: {
  itemType?: ItemType;
  itemId?: string;
  type?: string;
  sourceId?: string;
  page?: number;
}) {
  await requireMembership();
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  let query = supabase
    .from("stock_movements")
    .select(MOVEMENT_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * MOVEMENTS_PAGE_SIZE, page * MOVEMENTS_PAGE_SIZE - 1);
  if (filters.itemId && filters.itemType === "product") query = query.eq("product_id", filters.itemId);
  if (filters.itemId && filters.itemType === "raw_material") query = query.eq("raw_material_id", filters.itemId);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.sourceId) query = query.eq("source_id", filters.sourceId);
  const { data, error, count } = await query;
  if (error) throw new Error("Não foi possível carregar as movimentações.");

  // Nome de quem lançou (perfis visíveis por RLS: colegas da empresa).
  const rows = data as unknown as Movement[];
  const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of profiles ?? []) if (p.full_name) names.set(p.id as string, p.full_name as string);
  }
  // Quais já foram estornadas.
  const reversed = new Set<string>();
  if (rows.length) {
    const { data: rev } = await supabase.from("stock_movements").select("reversal_of").in("reversal_of", rows.map((r) => r.id));
    for (const r of rev ?? []) reversed.add(r.reversal_of as string);
  }
  return {
    rows: rows.map((r) => ({ ...r, author: r.created_by ? names.get(r.created_by) ?? null : null, reversed: reversed.has(r.id) })),
    total: count ?? 0,
    page,
  };
}

export type MovementResult = { movement_id: string; balance_after: string; duplicate?: boolean };
export type MovementActionResult =
  | { ok: true; message: string; data: MovementResult }
  | { ok: false; error?: string; fieldErrors?: Record<string, string>; conflict?: boolean };

export async function registerMovement(input: Record<string, unknown>): Promise<MovementActionResult> {
  await requireRole(STOCK_ROLES);
  const parsed = movementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_register_stock_movement", {
    p_client_op_id: v.op_id,
    p_item_type: v.itemType,
    p_item_id: v.itemId,
    p_type: v.type,
    p_quantity: v.quantity,
    p_unit_id: v.unit_id,
    p_unit_cost: v.unit_cost,
    p_reason: v.reason,
    p_notes: v.notes,
  });
  if (error) return { ok: false, error: dbErrorMessage(error), conflict: isConflict(error) };
  const result = data as MovementResult;
  return {
    ok: true,
    message: result.duplicate ? "Esta movimentação já havia sido registrada." : "Movimentação registrada.",
    data: result,
  };
}

export async function reverseMovement(input: Record<string, unknown>): Promise<ActionResult> {
  await requireRole(CATALOG_ROLES);
  const parsed = reversalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_reverse_stock_movement", {
    p_client_op_id: parsed.data.op_id,
    p_movement_id: parsed.data.movement_id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Movimentação estornada." };
}

// ---------------------------------------------------------------------------
// Inventário
// ---------------------------------------------------------------------------
export type InventoryCount = {
  id: string;
  scope: "all" | "products" | "raw_materials";
  status: "open" | "applied" | "canceled";
  notes: string | null;
  created_at: string;
  closed_at: string | null;
};

export type InventoryCountItem = {
  id: string;
  product_id: string | null;
  raw_material_id: string | null;
  expected_quantity: string;
  counted_quantity: string | null;
  counted_at: string | null;
  product: { name: string; sku: string | null; unit: { code: string } } | null;
  raw_material: { name: string; code: string | null; unit: { code: string } } | null;
};

export async function listInventoryCounts() {
  await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_counts")
    .select("id, scope, status, notes, created_at, closed_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Não foi possível carregar os inventários.");
  return data as InventoryCount[];
}

export async function getInventoryCount(id: string) {
  await requireMembership();
  const supabase = await createClient();
  const [{ data: count }, { data: items }, { data: balances }] = await Promise.all([
    supabase.from("inventory_counts").select("id, scope, status, notes, created_at, closed_at").eq("id", id).maybeSingle(),
    supabase
      .from("inventory_count_items")
      .select(
        "id, product_id, raw_material_id, expected_quantity, counted_quantity, counted_at, " +
          "product:products(name, sku, unit:measurement_units(code)), raw_material:raw_materials(name, code, unit:measurement_units(code))",
      )
      .eq("count_id", id),
    supabase.from("stock_balances").select("product_id, raw_material_id, quantity"),
  ]);
  if (!count) return null;
  const current = new Map<string, number>();
  for (const b of balances ?? []) current.set((b.product_id ?? b.raw_material_id) as string, Number(b.quantity));
  const rows = ((items ?? []) as unknown as InventoryCountItem[])
    .map((i) => ({ ...i, current_quantity: current.get((i.product_id ?? i.raw_material_id) as string) ?? 0 }))
    .sort((a, b) => (a.product?.name ?? a.raw_material?.name ?? "").localeCompare(b.product?.name ?? b.raw_material?.name ?? "", "pt-BR"));
  return { count: count as InventoryCount, items: rows };
}

export async function createInventoryCount(scope: string, notes: string | null): Promise<ActionResult<{ id: string }>> {
  await requireRole(CATALOG_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_inventory_count", { p_scope: scope, p_notes: notes });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, data: { id: data as string } };
}

export async function setCountedQuantity(itemId: string, value: number | null): Promise<ActionResult> {
  await requireRole(STOCK_ROLES);
  if (value !== null && (!Number.isFinite(value) || value < 0)) return { ok: false, error: "Quantidade inválida." };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("inventory_count_items")
    .update({ counted_quantity: value }, { count: "exact" })
    .eq("id", itemId);
  if (error || !count) return { ok: false, error: dbErrorMessage(error, "Não foi possível salvar a contagem.") };
  return { ok: true };
}

export async function applyInventoryCount(id: string): Promise<ActionResult<{ adjusted: number }>> {
  await requireRole(CATALOG_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_apply_inventory_count", { p_count_id: id });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  const adjusted = (data as { adjusted: number }).adjusted;
  return { ok: true, message: `Inventário aplicado: ${adjusted} ajuste(s) gerado(s).`, data: { adjusted } };
}

export async function cancelInventoryCount(id: string): Promise<ActionResult> {
  await requireRole(CATALOG_ROLES);
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_inventory_count", { p_count_id: id });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Inventário cancelado." };
}

// ---------------------------------------------------------------------------
// Fotos de produtos (arquivo enviado pelo navegador direto ao Storage, com RLS;
// aqui só se registra/remove o vínculo)
// ---------------------------------------------------------------------------
export async function listProductImages(productId: string): Promise<ProductImage[]> {
  await requireMembership();
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_images")
    .select("id, storage_path, alt, sort_order")
    .eq("product_id", productId)
    .order("sort_order")
    .order("created_at");
  return (data ?? []).map((i) => ({ ...(i as Omit<ProductImage, "url">), url: productImageUrl(i.storage_path as string) }));
}

export async function addProductImage(productId: string, storagePath: string): Promise<ActionResult> {
  const { companyId, user } = await requireRole(CATALOG_ROLES);
  const folder = productImageFolder(companyId, productId);
  if (!storagePath.startsWith(folder) || storagePath.slice(folder.length).includes("/")) {
    return { ok: false, error: "Caminho de imagem inválido." };
  }
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("product_images")
    .select("sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("product_images").insert({
    company_id: companyId,
    product_id: productId,
    storage_path: storagePath,
    sort_order: (last?.sort_order ?? -1) + 1,
    created_by: user.id,
  });
  if (error) {
    // Sem registro, o arquivo não serve para nada: remove.
    await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([storagePath]);
    return { ok: false, error: dbErrorMessage(error, "Não foi possível salvar a foto.") };
  }
  return { ok: true };
}

export async function removeProductImage(imageId: string): Promise<ActionResult> {
  await requireRole(CATALOG_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase.from("product_images").delete().eq("id", imageId).select("storage_path").maybeSingle();
  if (error || !data) return { ok: false, error: dbErrorMessage(error, "Não foi possível remover a foto.") };
  await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([data.storage_path as string]);
  return { ok: true, message: "Foto removida." };
}

/** Coloca a foto em primeiro lugar (principal), mantendo a ordem das demais. */
export async function setMainProductImage(productId: string, imageId: string): Promise<ActionResult> {
  await requireRole(CATALOG_ROLES);
  const supabase = await createClient();
  const { data } = await supabase.from("product_images").select("id").eq("product_id", productId).order("sort_order").order("created_at");
  const ids = (data ?? []).map((r) => r.id as string);
  if (!ids.includes(imageId)) return { ok: false, error: "Foto não encontrada." };
  const ordered = [imageId, ...ids.filter((id) => id !== imageId)];
  for (const [i, id] of ordered.entries()) {
    const { error } = await supabase.from("product_images").update({ sort_order: i }).eq("id", id);
    if (error) return { ok: false, error: dbErrorMessage(error) };
  }
  return { ok: true, message: "Foto principal definida." };
}
