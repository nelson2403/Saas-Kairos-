"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import {
  addProductImage,
  deleteCategory,
  removeProductImage,
  saveCategory,
  saveProduct,
  setMainProductImage,
} from "@/modules/inventory/service";

export async function saveProductAction(
  id: string | null,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const result = await saveProduct(id, Object.fromEntries(formData));
  if (!result.ok) return result;
  revalidatePath("/admin/produtos");
  revalidatePath("/admin/estoque");
  if (!id) redirect(`/admin/produtos/${result.data.id}?criado=1`);
  return { ok: true, message: result.message };
}

export async function saveCategoryAction(
  id: string | null,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const result = await saveCategory(id, Object.fromEntries(formData));
  if (result.ok) revalidatePath("/admin/produtos", "layout");
  return result;
}

export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  const result = await deleteCategory(id);
  if (result.ok) revalidatePath("/admin/produtos", "layout");
  return result;
}

function revalidateProduct(productId: string) {
  revalidatePath(`/admin/produtos/${productId}`);
  revalidatePath("/admin/produtos");
}

export async function addProductImageAction(productId: string, storagePath: string): Promise<ActionResult> {
  const result = await addProductImage(productId, storagePath);
  if (result.ok) revalidateProduct(productId);
  return result;
}

export async function removeProductImageAction(productId: string, imageId: string): Promise<ActionResult> {
  const result = await removeProductImage(imageId);
  if (result.ok) revalidateProduct(productId);
  return result;
}

export async function setMainProductImageAction(productId: string, imageId: string): Promise<ActionResult> {
  const result = await setMainProductImage(productId, imageId);
  if (result.ok) revalidateProduct(productId);
  return result;
}
