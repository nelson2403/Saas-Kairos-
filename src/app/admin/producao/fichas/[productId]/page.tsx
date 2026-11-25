import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Factory } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { requireMembership } from "@/lib/auth/dal";
import { formatQuantity } from "@/modules/inventory/domain";
import { canManageRecipes, canProduce, getRecipeEditor } from "@/modules/production/service";
import { RecipeEditor } from "./recipe-editor";

export const metadata: Metadata = { title: "Ficha técnica" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default function RecipePage(props: PageProps<"/admin/producao/fichas/[productId]">) {
  return (
    <Suspense fallback={<SectionSkeleton lines={4} />}>
      <Recipe {...props} />
    </Suspense>
  );
}

async function Recipe({ params }: PageProps<"/admin/producao/fichas/[productId]">) {
  const { productId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(productId)) notFound();
  const [{ role }, data] = await Promise.all([requireMembership(), getRecipeEditor(productId)]);
  if (!data) notFound();
  const unitsById = new Map(data.units.map((u) => [u.id, u]));
  const materialsById = new Map(data.materials.map((m) => [m.id, m]));
  const productUnit = unitsById.get(data.product.unit_id);

  return (
    <>
      <PageHeader title={`Ficha técnica · ${data.product.name}`} description={data.active ? `Versão ${data.active.version} ativa` : "Sem ficha técnica ativa"}>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/producao/fichas" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft aria-hidden /> Fichas
          </Link>
          {data.active && canProduce(role) && data.product.status !== "archived" && (
            <Link href={`/admin/producao/nova?produto=${productId}`} className={buttonVariants()}>
              <Factory aria-hidden /> Produzir
            </Link>
          )}
        </div>
      </PageHeader>

      <div className="grid gap-4">
        <Card>
          <RecipeEditor
            product={{ id: data.product.id, name: data.product.name, salePrice: Number(data.product.sale_price), unitCode: productUnit?.code ?? "" }}
            active={
              data.active && {
                yield_quantity: data.active.yield_quantity,
                loss_percent: data.active.loss_percent,
                notes: data.active.notes,
                items: [...data.active.items].sort((a, b) => a.sort_order - b.sort_order),
              }
            }
            materials={data.materials.filter((m) => m.status !== "archived")}
            units={data.units}
            canEdit={canManageRecipes(role) && data.product.status !== "archived"}
          />
        </Card>

        {data.versions.length > 0 && (
          <Card>
            <CardTitle className="mb-3">Histórico de versões</CardTitle>
            <p className="mb-3 text-sm text-muted-foreground">
              Cada alteração gera uma nova versão. As ordens de produção guardam a versão usada, então o histórico de custos não muda.
            </p>
            <ul className="divide-y divide-border">
              {data.versions.map((v) => (
                <li key={v.id} className="py-3 text-sm">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                      <span className="font-medium">Versão {v.version}</span>
                      {v.is_active && <Badge tone="success">Ativa</Badge>}
                      <span className="text-muted-foreground">
                        {dateFormat.format(new Date(v.created_at))} · rende {formatQuantity(v.yield_quantity, productUnit?.code)} · perda {formatQuantity(v.loss_percent)}%
                      </span>
                    </summary>
                    <ul className="mt-2 space-y-1 pl-4 text-muted-foreground">
                      {[...v.items]
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .map((i) => (
                          <li key={i.raw_material_id}>
                            {materialsById.get(i.raw_material_id)?.name ?? "Matéria-prima removida"}: {formatQuantity(i.quantity, unitsById.get(i.unit_id)?.code)}
                          </li>
                        ))}
                    </ul>
                    {v.notes && <p className="mt-2 pl-4 text-muted-foreground">{v.notes}</p>}
                  </details>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
