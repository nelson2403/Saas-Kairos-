"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { STORE_TAG } from "@/modules/store/data";
import { publishStorefront, restoreVersion, saveDraft } from "@/modules/storefront/service";

export async function saveDraftAction(input: unknown): Promise<ActionResult<{ savedAt: string }>> {
  const result = await saveDraft(input);
  if (result.ok) revalidatePath("/admin/loja");
  return result;
}

/** Salva o rascunho atual e publica, numa sequência (o que está na tela é o que vai ao ar). */
export async function publishAction(input: unknown, note: string): Promise<ActionResult<{ version: number }>> {
  const saved = await saveDraft(input);
  if (!saved.ok) return saved;
  const result = await publishStorefront(note);
  if (result.ok) {
    revalidateTag(STORE_TAG, "max");
    revalidatePath("/admin/loja");
  }
  return result;
}

export async function restoreVersionAction(version: number): Promise<ActionResult> {
  const result = await restoreVersion(version);
  if (result.ok) revalidatePath("/admin/loja");
  return result;
}
