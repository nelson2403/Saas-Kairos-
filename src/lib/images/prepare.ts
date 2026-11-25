/**
 * Reduz a foto no próprio aparelho (lado maior até `maxSide`, WebP ~85%) antes
 * do envio: fotos de celular têm 3–10 MB; assim o envio é rápido e a loja leve.
 */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function prepareImage(file: File, maxSide = 1600): Promise<{ blob: Blob; ext: string; type: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await toBlob("image/webp");
  if (webp && webp.type === "image/webp") return { blob: webp, ext: "webp", type: "image/webp" };
  const jpeg = await toBlob("image/jpeg"); // Safari antigo não gera WebP
  if (!jpeg) throw new Error("Não foi possível processar a imagem.");
  return { blob: jpeg, ext: "jpg", type: "image/jpeg" };
}
