"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { useOffline } from "next/offline";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { ACCEPTED_IMAGE_TYPES as ACCEPTED, prepareImage } from "@/lib/images/prepare";
import { MAX_PRODUCT_IMAGES, PRODUCT_IMAGES_BUCKET, productImageFolder, type ProductImage } from "@/modules/inventory/images";
import { addProductImageAction, removeProductImageAction, setMainProductImageAction } from "../actions";

export function ProductPhotos({
  productId,
  companyId,
  productName,
  images,
  canEdit,
}: {
  productId: string;
  companyId: string;
  productName: string;
  images: ProductImage[];
  canEdit: boolean;
}) {
  const isOffline = useOffline();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const remaining = MAX_PRODUCT_IMAGES - images.length;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const list = Array.from(files).slice(0, remaining);
    if (files.length > remaining) setError(`Limite de ${MAX_PRODUCT_IMAGES} fotos por produto: ${files.length - remaining} não foram enviadas.`);
    const supabase = createClient();

    for (const [i, file] of list.entries()) {
      if (!ACCEPTED.includes(file.type)) {
        setError(`"${file.name}" não é JPG, PNG ou WebP.`);
        continue;
      }
      setUploading(`Enviando ${i + 1} de ${list.length}…`);
      try {
        const { blob, ext, type } = await prepareImage(file);
        const path = `${productImageFolder(companyId, productId)}${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(PRODUCT_IMAGES_BUCKET)
          .upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false });
        if (upErr) throw new Error("Falha no envio da foto. Verifique a conexão e tente de novo.");
        const r = await addProductImageAction(productId, path);
        if (!r.ok) throw new Error(r.error ?? "Não foi possível salvar a foto.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não foi possível enviar a foto.");
      }
    }
    setUploading(null);
    if (input.current) input.current.value = "";
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.ok ? null : (r.error ?? "Não foi possível concluir."));
    });

  return (
    <div className="space-y-4">
      {images.length === 0 && !canEdit && <p className="text-sm text-muted-foreground">Nenhuma foto cadastrada.</p>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {images.map((img, i) => (
          <li key={img.id} className="group relative overflow-hidden rounded-md border border-border bg-muted">
            <div className="relative aspect-square">
              <Image src={img.url} alt={img.alt ?? `${productName} — foto ${i + 1}`} fill sizes="(max-width: 640px) 50vw, 200px" className="object-cover" />
            </div>
            {i === 0 && <span className="absolute left-2 top-2 rounded-full bg-surface/90 px-2 py-0.5 text-xs font-medium">Principal</span>}
            {canEdit && (
              <div className="flex justify-end gap-1 border-t border-border bg-surface p-1">
                {i > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => run(() => setMainProductImageAction(productId, img.id))}
                    aria-label="Definir como foto principal"
                    title="Definir como principal"
                  >
                    <Star aria-hidden />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => confirm("Remover esta foto?") && run(() => removeProductImageAction(productId, img.id))}
                  aria-label="Remover foto"
                  title="Remover"
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            )}
          </li>
        ))}
        {canEdit && remaining > 0 && (
          <li>
            <label
              className={`flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-3 text-center text-sm text-muted-foreground hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40 ${uploading || isOffline ? "pointer-events-none opacity-60" : ""}`}
            >
              {uploading ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <ImagePlus className="size-6" aria-hidden />}
              <span>{uploading ?? (isOffline ? "Sem conexão" : "Adicionar foto")}</span>
              <input
                ref={input}
                type="file"
                accept={ACCEPTED.join(",")}
                multiple
                className="sr-only"
                disabled={!!uploading || isOffline}
                onChange={(e) => void upload(e.target.files)}
              />
            </label>
          </li>
        )}
      </ul>
      {canEdit && (
        <p className="text-xs text-muted-foreground">
          JPG, PNG ou WebP, até {MAX_PRODUCT_IMAGES} fotos. A primeira é a principal (usada na loja e nas listas). As fotos são
          reduzidas automaticamente antes do envio.
        </p>
      )}
      <FieldError message={error ?? undefined} />
    </div>
  );
}
