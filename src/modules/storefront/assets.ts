import { getPublicSupabaseEnv } from "@/lib/env";

export const STORE_ASSETS_BUCKET = "store-assets";

/** URL pública de uma imagem da loja. */
export function storeAssetUrl(path: string | null | undefined) {
  const env = getPublicSupabaseEnv();
  if (!env || !path) return "";
  return `${env.url}/storage/v1/object/public/${STORE_ASSETS_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export const storeAssetFolder = (companyId: string) => `${companyId}/store/`;
