"use server";

import { revalidatePath } from "next/cache";
import { updateCompany, type ActionResult } from "@/modules/company/service";

export async function saveCompany(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await updateCompany(Object.fromEntries(formData));
  if (result.ok) revalidatePath("/admin", "layout");
  return result;
}
