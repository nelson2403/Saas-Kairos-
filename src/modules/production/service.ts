import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireMembership, requireRole, type RoleKey } from "@/lib/auth/dal";
import { dbErrorMessage, isConflict, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { CATALOG_ROLES, STOCK_ROLES, listUnits } from "@/modules/inventory/service";
import type { Unit } from "@/modules/inventory/domain";
import { estimateRecipeCost, materialCost, type CostEstimate, type OrderStatus, type RecipeLine } from "./domain";
import { cancelOrderSchema, completeOrderSchema, createOrderSchema, recipeSchema, reverseOrderSchema } from "./schemas";

/** Quem edita fichas técnicas e estorna ordens. */
export const canManageRecipes = (role: RoleKey) => CATALOG_ROLES.includes(role);
/** Quem abre, conclui e cancela ordens. */
export const canProduce = (role: RoleKey) => STOCK_ROLES.includes(role);

// ---------------------------------------------------------------------------
// Insumos com custo e saldo atuais
// ---------------------------------------------------------------------------
export type MaterialInfo = {
  id: string;
  name: string;
  code: string | null;
  unitId: string;
  density: number | null;
  status: string;
  cost: number | null;
  quantity: number;
};

async function loadMaterials(): Promise<Map<string, MaterialInfo>> {
  const supabase = await createClient();
  const [{ data: raws, error }, { data: balances }] = await Promise.all([
    supabase.from("raw_materials").select("id, name, code, unit_id, density, status, last_cost").order("name"),
    supabase.from("stock_balances").select("raw_material_id, quantity, avg_cost").not("raw_material_id", "is", null),
  ]);
  if (error) throw new Error("Não foi possível carregar as matérias-primas.");
  const bal = new Map((balances ?? []).map((b) => [b.raw_material_id as string, b]));
  return new Map(
    (raws ?? []).map((r) => {
      const b = bal.get(r.id as string);
      return [
        r.id as string,
        {
          id: r.id as string,
          name: r.name as string,
          code: r.code as string | null,
          unitId: r.unit_id as string,
          density: r.density == null ? null : Number(r.density),
          status: r.status as string,
          cost: materialCost(b?.avg_cost as string | undefined, r.last_cost as string | null),
          quantity: Number(b?.quantity ?? 0),
        },
      ];
    }),
  );
}

// ---------------------------------------------------------------------------
// Fichas técnicas
// ---------------------------------------------------------------------------
type RecipeRow = {
  id: string;
  version: number;
  yield_quantity: string;
  loss_percent: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  items: { raw_material_id: string; quantity: string; unit_id: string; sort_order: number }[];
};

const RECIPE_SELECT = "id, version, yield_quantity, loss_percent, notes, is_active, created_at, items:recipe_items(raw_material_id, quantity, unit_id, sort_order)";

function toLines(recipe: RecipeRow, materials: Map<string, MaterialInfo>, units: Map<string, Unit>): RecipeLine[] {
  return [...recipe.items]
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((i) => {
      const m = materials.get(i.raw_material_id);
      const unit = units.get(i.unit_id);
      const stockUnit = m ? units.get(m.unitId) : undefined;
      if (!m || !unit || !stockUnit) return [];
      return [{ rawMaterialId: m.id, quantity: Number(i.quantity), unit, stockUnit, density: m.density, cost: m.cost }];
    });
}

export type RecipeOverview = {
  product: { id: string; name: string; sku: string | null; sale_price: string; status: string; unit: { code: string } };
  recipe: { version: number; yield_quantity: number; loss_percent: number; items: number } | null;
  estimate: CostEstimate | null;
};

/** Produtos com a situação da ficha técnica e o custo estimado com os custos atuais. */
export async function listRecipeOverview(): Promise<RecipeOverview[]> {
  await requireMembership();
  const supabase = await createClient();
  const [{ data, error }, materials, unitList] = await Promise.all([
    supabase
      .from("products")
      .select(`id, name, sku, sale_price, status, unit:measurement_units(code), recipes:product_recipes(${RECIPE_SELECT})`)
      .neq("status", "archived")
      .eq("recipes.is_active", true)
      .order("name")
      .limit(500),
    loadMaterials(),
    listUnits(),
  ]);
  if (error) throw new Error("Não foi possível carregar as fichas técnicas.");
  const units = new Map(unitList.map((u) => [u.id, u]));
  return (data as unknown as (RecipeOverview["product"] & { recipes: RecipeRow[] })[]).map(({ recipes, ...product }) => {
    const r = recipes[0];
    if (!r) return { product, recipe: null, estimate: null };
    const y = Number(r.yield_quantity);
    const loss = Number(r.loss_percent);
    return {
      product,
      recipe: { version: r.version, yield_quantity: y, loss_percent: loss, items: r.items.length },
      estimate: estimateRecipeCost(toLines(r, materials, units), y, loss),
    };
  });
}

export type RecipeEditorData = {
  product: { id: string; name: string; sale_price: string; status: string; unit_id: string };
  active: RecipeRow | null;
  versions: RecipeRow[];
  materials: MaterialInfo[];
  units: Unit[];
};

export async function getRecipeEditor(productId: string): Promise<RecipeEditorData | null> {
  await requireMembership();
  const supabase = await createClient();
  const [{ data: product }, { data: versions }, materials, units] = await Promise.all([
    supabase.from("products").select("id, name, sale_price, status, unit_id").eq("id", productId).maybeSingle(),
    supabase.from("product_recipes").select(RECIPE_SELECT).eq("product_id", productId).order("version", { ascending: false }),
    loadMaterials(),
    listUnits(),
  ]);
  if (!product) return null;
  const rows = (versions ?? []) as unknown as RecipeRow[];
  return {
    product: product as RecipeEditorData["product"],
    active: rows.find((r) => r.is_active) ?? null,
    versions: rows,
    materials: [...materials.values()],
    units,
  };
}

/** Quantas fichas técnicas (qualquer versão) usam a matéria-prima. */
export async function countRecipesUsing(rawMaterialId: string) {
  await requireMembership();
  const supabase = await createClient();
  const { count } = await supabase.from("recipe_items").select("id", { count: "exact", head: true }).eq("raw_material_id", rawMaterialId);
  return count ?? 0;
}

/** Versões da ficha de um produto: quantas existem e qual está ativa. */
export async function getRecipeStatus(productId: string) {
  await requireMembership();
  const supabase = await createClient();
  const { data } = await supabase.from("product_recipes").select("version, is_active").eq("product_id", productId);
  return { versions: data?.length ?? 0, activeVersion: (data ?? []).find((r) => r.is_active)?.version as number | undefined };
}

export async function saveRecipe(input: unknown): Promise<ActionResult<{ version: number }>> {
  await requireRole(CATALOG_ROLES);
  const parsed = recipeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_save_recipe", {
    p_product_id: v.product_id,
    p_yield: v.yield_quantity,
    p_loss: v.loss_percent,
    p_items: v.items,
    p_notes: v.notes,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  const version = (data as { version: number }).version;
  return { ok: true, message: `Ficha técnica salva (versão ${version}).`, data: { version } };
}

export async function deactivateRecipe(productId: string): Promise<ActionResult> {
  await requireRole(CATALOG_ROLES);
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_deactivate_recipe", { p_product_id: productId });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Ficha técnica desativada. O produto não pode ser produzido até salvar uma nova." };
}

// ---------------------------------------------------------------------------
// Ordens de produção
// ---------------------------------------------------------------------------
export type OrderListItem = {
  id: string;
  number: number;
  status: OrderStatus;
  planned_quantity: string;
  produced_quantity: string | null;
  unit_cost: string | null;
  cost_complete: boolean | null;
  created_at: string;
  completed_at: string | null;
  product: { id: string; name: string; unit: { code: string } };
};

export const ORDERS_PAGE_SIZE = 50;

export async function listOrders(filters: { status?: OrderStatus; productId?: string; page?: number }) {
  await requireMembership();
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  let query = supabase
    .from("production_orders")
    .select(
      "id, number, status, planned_quantity, produced_quantity, unit_cost, cost_complete, created_at, completed_at, product:products(id, name, unit:measurement_units(code))",
      { count: "exact" },
    )
    .order("number", { ascending: false })
    .range((page - 1) * ORDERS_PAGE_SIZE, page * ORDERS_PAGE_SIZE - 1);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.productId) query = query.eq("product_id", filters.productId);
  const { data, error, count } = await query;
  if (error) throw new Error("Não foi possível carregar as ordens de produção.");
  return { rows: data as unknown as OrderListItem[], total: count ?? 0, page };
}

export async function countOpenOrders() {
  await requireMembership();
  const supabase = await createClient();
  const { count } = await supabase.from("production_orders").select("id", { count: "exact", head: true }).eq("status", "planned");
  return count ?? 0;
}

export type OrderDetail = OrderListItem & {
  notes: string | null;
  close_reason: string | null;
  material_cost: string | null;
  closed_at: string | null;
  created_by: string | null;
  completed_by: string | null;
  closed_by: string | null;
  recipe: { version: number; yield_quantity: string; loss_percent: string };
  items: {
    raw_material_id: string;
    planned_quantity: string;
    actual_quantity: string | null;
    unit_cost: string | null;
    total_cost: string | null;
    raw_material: { id: string; name: string; code: string | null; unit: { code: string } };
  }[];
  /** Saldo atual de cada insumo (para conferir antes de concluir). */
  available: Record<string, number>;
  /** Custo atual de cada insumo (prévia do custo antes de concluir). */
  currentCost: Record<string, number | null>;
  people: Record<string, string>;
};

export async function getOrder(id: string): Promise<OrderDetail | null> {
  await requireMembership();
  const supabase = await createClient();
  const { data } = await supabase
    .from("production_orders")
    .select(
      "id, number, status, planned_quantity, produced_quantity, unit_cost, cost_complete, material_cost, notes, close_reason, " +
        "created_at, completed_at, closed_at, created_by, completed_by, closed_by, " +
        "product:products(id, name, unit:measurement_units(code)), recipe:product_recipes(version, yield_quantity, loss_percent), " +
        "items:production_order_items(raw_material_id, planned_quantity, actual_quantity, unit_cost, total_cost, raw_material:raw_materials(id, name, code, unit:measurement_units(code)))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const order = data as unknown as Omit<OrderDetail, "available" | "currentCost" | "people">;
  order.items.sort((a, b) => a.raw_material.name.localeCompare(b.raw_material.name, "pt-BR"));

  const materials = await loadMaterials();
  const available: Record<string, number> = {};
  const currentCost: Record<string, number | null> = {};
  for (const i of order.items) {
    available[i.raw_material_id] = materials.get(i.raw_material_id)?.quantity ?? 0;
    currentCost[i.raw_material_id] = materials.get(i.raw_material_id)?.cost ?? null;
  }

  const ids = [order.created_by, order.completed_by, order.closed_by].filter(Boolean) as string[];
  const people: Record<string, string> = {};
  if (ids.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of profiles ?? []) if (p.full_name) people[p.id as string] = p.full_name as string;
  }
  return { ...order, available, currentCost, people };
}

export type ProducibleProduct = {
  id: string;
  name: string;
  sku: string | null;
  unitCode: string;
  recipe: { version: number; yield_quantity: number; loss_percent: number };
  lines: (RecipeLine & { name: string; stockUnitCode: string; available: number })[];
};

/** Produtos que podem ser produzidos agora (ficha técnica ativa, não arquivados). */
export async function listProducibleProducts(): Promise<ProducibleProduct[]> {
  await requireMembership();
  const supabase = await createClient();
  const [{ data, error }, materials, unitList] = await Promise.all([
    supabase
      .from("products")
      .select(`id, name, sku, unit:measurement_units(code), recipes:product_recipes!inner(${RECIPE_SELECT})`)
      .neq("status", "archived")
      .eq("recipes.is_active", true)
      .order("name"),
    loadMaterials(),
    listUnits(),
  ]);
  if (error) throw new Error("Não foi possível carregar os produtos.");
  const units = new Map(unitList.map((u) => [u.id, u]));
  type Row = { id: string; name: string; sku: string | null; unit: { code: string }; recipes: RecipeRow[] };
  return (data as unknown as Row[]).map((p) => {
    const r = p.recipes[0];
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      unitCode: p.unit.code,
      recipe: { version: r.version, yield_quantity: Number(r.yield_quantity), loss_percent: Number(r.loss_percent) },
      lines: toLines(r, materials, units).map((l) => ({
        ...l,
        name: materials.get(l.rawMaterialId)!.name,
        stockUnitCode: l.stockUnit.code,
        available: materials.get(l.rawMaterialId)!.quantity,
      })),
    };
  });
}

export async function createOrder(input: Record<string, unknown>): Promise<ActionResult<{ order_id: string; number: number }>> {
  await requireRole(STOCK_ROLES);
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_production_order", {
    p_client_op_id: v.op_id,
    p_product_id: v.product_id,
    p_quantity: v.quantity,
    p_notes: v.notes,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Ordem de produção aberta.", data: data as { order_id: string; number: number } };
}

export type CompleteResult = { order_id: string; number: number; unit_cost: string; cost_complete: boolean; duplicate?: boolean };
export type CompleteActionResult =
  | { ok: true; message: string; data: CompleteResult }
  | { ok: false; error?: string; fieldErrors?: Record<string, string>; conflict?: boolean };

export async function completeOrder(input: unknown): Promise<CompleteActionResult> {
  await requireRole(STOCK_ROLES);
  const parsed = completeOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_complete_production_order", {
    p_client_op_id: v.op_id,
    p_order_id: v.order_id,
    p_produced_quantity: v.produced_quantity,
    p_items: v.items,
    p_notes: v.notes,
  });
  if (error) return { ok: false, error: dbErrorMessage(error), conflict: isConflict(error) };
  const result = data as CompleteResult;
  return {
    ok: true,
    message: result.duplicate ? "Esta conclusão já havia sido registrada." : "Produção concluída: insumos baixados e produto lançado no estoque.",
    data: result,
  };
}

export async function cancelOrder(input: Record<string, unknown>): Promise<ActionResult> {
  await requireRole(STOCK_ROLES);
  const parsed = cancelOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_production_order", { p_order_id: parsed.data.order_id, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Ordem cancelada." };
}

export async function reverseOrder(input: Record<string, unknown>): Promise<ActionResult> {
  await requireRole(CATALOG_ROLES);
  const parsed = reverseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_reverse_production_order", {
    p_client_op_id: parsed.data.op_id,
    p_order_id: parsed.data.order_id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Produção estornada: insumos devolvidos e produto retirado do estoque." };
}
