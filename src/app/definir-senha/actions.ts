"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { changeOwnPassword } from "@/modules/team/service";

export async function changePasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await changeOwnPassword({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!result.ok) return result;
  redirect("/admin");
}
