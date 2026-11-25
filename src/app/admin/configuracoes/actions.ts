"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { updateCompany } from "@/modules/company/service";
import { createUnit, saveStockSettings } from "@/modules/inventory/service";

export async function saveCompany(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await updateCompany(Object.fromEntries(formData));
  if (result.ok) revalidatePath("/admin", "layout");
  return result;
}

export async function saveStockSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await saveStockSettings(formData.get("allow_negative") === "on");
  if (result.ok) revalidatePath("/admin/configuracoes");
  return result;
}

export async function createUnitAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await createUnit(Object.fromEntries(formData));
  if (result.ok) revalidatePath("/admin", "layout");
  return result;
}
