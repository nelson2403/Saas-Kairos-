import { getPublicSupabaseEnv } from "@/lib/env";

export const PRODUCT_IMAGES_BUCKET = "product-images";
export const MAX_PRODUCT_IMAGES = 8;

/** URL pública da foto (bucket público, usado também pela loja). */
export function productImageUrl(storagePath: string) {
  const env = getPublicSupabaseEnv();
  if (!env) return "";
  return `${env.url}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
}

/** Pasta de um produto: <empresa>/products/<produto>/ */
export const productImageFolder = (companyId: string, productId: string) => `${companyId}/products/${productId}/`;

export type ProductImage = { id: string; storage_path: string; alt: string | null; sort_order: number; url: string };
