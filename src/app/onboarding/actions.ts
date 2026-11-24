"use server";

import { redirect } from "next/navigation";
import { createCompany, type ActionResult } from "@/modules/company/service";
import { requireUser } from "@/lib/auth/dal";

export async function createCompanyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const result = await createCompany(Object.fromEntries(formData));
  if (!result.ok) return result;
  redirect("/admin");
}
