export type ActionResult<T = undefined> =
  | ({ ok: true; message?: string } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error?: string; fieldErrors?: Record<string, string> };

export function toFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

type DbError = { code?: string; message?: string; details?: string } | null | undefined;

const UNIQUE_MESSAGES: [string, string][] = [
  ["products_sku_uq", "Já existe um produto com este SKU."],
  ["products_barcode_uq", "Já existe um produto com este código de barras."],
  ["products_company_id_slug_key", "Já existe um produto com este nome de URL."],
  ["raw_materials_code_uq", "Já existe uma matéria-prima com este código."],
  ["product_categories_name_uq", "Já existe uma categoria com este nome."],
  ["measurement_units_company_id_code_key", "Já existe uma unidade com esta sigla."],
];

/**
 * Converte erro do Postgres/PostgREST em mensagem para o usuário.
 * Mensagens das funções do banco (P0001/P0002/42501) já são escritas em português.
 */
export function dbErrorMessage(error: DbError, fallback = "Não foi possível concluir. Tente novamente."): string {
  if (!error) return fallback;
  const msg = error.message ?? "";
  if (error.code === "23505") {
    return UNIQUE_MESSAGES.find(([key]) => msg.includes(key) || error.details?.includes(key))?.[1] ?? "Registro duplicado.";
  }
  if (error.code === "42501") {
    return /row-level security|permission denied/i.test(msg) ? "Sem permissão para esta operação." : msg;
  }
  if (error.code === "P0001" || error.code === "P0002") return msg;
  if (error.code === "23503") return "Referência inválida (item, categoria ou unidade).";
  return fallback;
}

/** Saldo insuficiente e afins: conflito de estado, não erro de validação. */
export const isConflict = (error: DbError) => error?.code === "P0002";
