import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { MovementTable } from "@/components/inventory/movement-table";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { requireMembership } from "@/lib/auth/dal";
import { MOVEMENT_LABEL, type ItemType } from "@/modules/inventory/domain";
import { MOVEMENTS_PAGE_SIZE, canManageCatalog, canMoveStock, listMovements } from "@/modules/inventory/service";

export const metadata: Metadata = { title: "Movimentações" };

export default function MovementsPage({ searchParams }: PageProps<"/admin/movimentacoes">) {
  return (
    <>
      <PageHeader title="Movimentações" description="Histórico completo e imutável. Correções são feitas por estorno.">
        <Suspense>
          <NewButton />
        </Suspense>
      </PageHeader>
      <Card>
        <Suspense fallback={<SectionSkeleton />}>
          <History searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

async function NewButton() {
  const { role } = await requireMembership();
  if (!canMoveStock(role)) return null;
  return (
    <Link href="/admin/movimentacoes/nova" className={buttonVariants()}>
      <Plus aria-hidden /> Registrar movimentação
    </Link>
  );
}

async function History({ searchParams }: { searchParams: PageProps<"/admin/movimentacoes">["searchParams"] }) {
  const sp = await searchParams;
  const { role } = await requireMembership();
  const type = typeof sp.tipo === "string" && sp.tipo in MOVEMENT_LABEL ? sp.tipo : undefined;
  const itemParam = typeof sp.item === "string" ? sp.item.match(/^(product|raw_material):([0-9a-f-]{36})$/) : null;
  const page = Math.max(1, Number(sp.pagina) || 1);
  const { rows, total } = await listMovements({
    type,
    itemType: itemParam?.[1] as ItemType | undefined,
    itemId: itemParam?.[2],
    page,
  });
  const pages = Math.max(1, Math.ceil(total / MOVEMENTS_PAGE_SIZE));
  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (type) params.set("tipo", type);
    if (itemParam) params.set("item", itemParam[0]);
    if (p > 1) params.set("pagina", String(p));
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  return (
    <>
      <form className="mb-4 flex flex-wrap gap-2">
        {itemParam && <input type="hidden" name="item" value={itemParam[0]} />}
        <Select name="tipo" defaultValue={type ?? ""} aria-label="Tipo" className="w-auto">
          <option value="">Todos os tipos</option>
          {Object.entries(MOVEMENT_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Filtrar
        </button>
        {(type || itemParam) && (
          <Link href="/admin/movimentacoes" className={buttonVariants({ variant: "ghost" })}>
            Limpar filtros
          </Link>
        )}
      </form>
      <MovementTable rows={rows} canReverse={canManageCatalog(role)} />
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginação">
          <span className="text-muted-foreground">
            Página {page} de {pages} · {total} movimentações
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={`/admin/movimentacoes${qs(page - 1)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Anterior
              </Link>
            )}
            {page < pages && (
              <Link href={`/admin/movimentacoes${qs(page + 1)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Próxima
              </Link>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
