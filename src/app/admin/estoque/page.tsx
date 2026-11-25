import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeftRight, ClipboardCheck } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { requireMembership } from "@/lib/auth/dal";
import { formatCost, formatMoney, formatQuantity, type ItemType } from "@/modules/inventory/domain";
import { canMoveStock, getStockOverview } from "@/modules/inventory/service";

export const metadata: Metadata = { title: "Estoque" };

export default function StockPage({ searchParams }: PageProps<"/admin/estoque">) {
  return (
    <>
      <PageHeader title="Estoque" description="Saldos de produtos acabados e matérias-primas.">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/estoque/inventario" className={buttonVariants({ variant: "outline" })}>
            <ClipboardCheck aria-hidden /> Inventário
          </Link>
          <Suspense>
            <MoveButton />
          </Suspense>
        </div>
      </PageHeader>
      <Card>
        <Suspense fallback={<SectionSkeleton />}>
          <Overview searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

async function MoveButton() {
  const { role } = await requireMembership();
  if (!canMoveStock(role)) return null;
  return (
    <Link href="/admin/movimentacoes/nova" className={buttonVariants()}>
      <ArrowLeftRight aria-hidden /> Registrar movimentação
    </Link>
  );
}

const TABS = [
  { key: "product", label: "Produtos acabados" },
  { key: "raw_material", label: "Matérias-primas" },
  { key: "baixo", label: "Abaixo do mínimo" },
];

async function Overview({ searchParams }: { searchParams: PageProps<"/admin/estoque">["searchParams"] }) {
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.ver) ? (sp.ver as string) : "product";
  const q = typeof sp.q === "string" ? sp.q : "";
  const rows = await getStockOverview({
    type: tab === "baixo" ? undefined : (tab as ItemType),
    belowMin: tab === "baixo",
    q,
  });
  const visible = tab === "baixo" ? rows.filter((r) => r.status === "active") : rows;
  const totalValue = visible.reduce((sum, r) => sum + Math.max(Number(r.quantity), 0) * Number(r.avg_cost), 0);

  return (
    <>
      <LinkTabs active={tab} items={TABS.map((t) => ({ ...t, href: `/admin/estoque?ver=${t.key}` }))} />
      <form className="mb-4 flex gap-2" role="search">
        <input type="hidden" name="ver" value={tab} />
        <Input name="q" defaultValue={q} placeholder="Buscar por nome ou código" aria-label="Buscar no estoque" />
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Buscar
        </button>
      </form>

      {visible.length === 0 ? (
        <EmptyState title={tab === "baixo" ? "Nenhum item abaixo do estoque mínimo." : "Nenhum item encontrado."}>
          {tab === "baixo" && "Itens só entram aqui quando têm estoque mínimo definido no cadastro."}
        </EmptyState>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th className="text-right">Saldo</Th>
                <Th className="text-right">Reservado</Th>
                <Th className="text-right">Mínimo</Th>
                <Th className="text-right">Custo médio</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const href = r.item_type === "product" ? `/admin/produtos/${r.item_id}` : `/admin/materias-primas/${r.item_id}`;
                const negative = Number(r.quantity) < 0;
                return (
                  <tr key={`${r.item_type}:${r.item_id}`} className="hover:bg-muted/40">
                    <Td>
                      <Link href={href} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {tab === "baixo" && (r.item_type === "product" ? "Produto · " : "Matéria-prima · ")}
                        {r.code ?? ""}
                        {r.status === "inactive" && " · inativo"}
                      </span>
                    </Td>
                    <Td className={`whitespace-nowrap text-right tabular-nums ${negative ? "text-danger" : ""}`}>
                      {formatQuantity(r.quantity, r.unit_code)}
                      {r.below_min && (
                        <Badge tone="warning" className="ml-2">
                          Baixo
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums text-muted-foreground">
                      {Number(r.reserved_quantity) > 0 ? formatQuantity(r.reserved_quantity, r.unit_code) : "—"}
                    </Td>
                    <Td className="text-right tabular-nums text-muted-foreground">
                      {Number(r.min_stock) > 0 ? formatQuantity(r.min_stock, r.unit_code) : "—"}
                    </Td>
                    <Td className="text-right tabular-nums">{Number(r.avg_cost) > 0 ? `${formatCost(r.avg_cost)}/${r.unit_code}` : "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="mt-4 text-sm text-muted-foreground">
            Valor em estoque (saldo × custo médio, itens listados): <strong className="text-foreground">{formatMoney(totalValue)}</strong>.
            Itens sem custo informado não entram no total.
          </p>
        </>
      )}
    </>
  );
}
