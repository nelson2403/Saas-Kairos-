"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { updateCompany } from "@/modules/company/service";
import { createUnit, saveStockSettings } from "@/modules/inventory/service";
import { STORE_TAG } from "@/modules/store/data";
import { saveStoreSettings } from "@/modules/store/service";

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

export async function saveStoreSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const on = (k: string) => formData.get(k) === "on";
  const s = (k: string) => String(formData.get(k) ?? "");
  const result = await saveStoreSettings({
    enabled: on("enabled"),
    whatsapp: s("whatsapp"),
    pickup_enabled: on("pickup_enabled"),
    pickup_address: s("pickup_address"),
    delivery_enabled: on("delivery_enabled"),
    delivery_fee: s("delivery_fee"),
    delivery_notes: s("delivery_notes"),
    payment_instructions: s("payment_instructions"),
    reservation_hours: s("reservation_hours"),
  });
  if (result.ok) {
    revalidateTag(STORE_TAG, "max");
    revalidatePath("/admin/configuracoes");
  }
  return result;
}
