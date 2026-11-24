import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ADMIN_MODULES } from "@/config/modules";

export const metadata: Metadata = { title: "Mais" };

/** Acesso a todos os módulos no celular. */
export default function MorePage() {
  return (
    <>
      <PageHeader title="Mais" description="Todos os módulos do Kairós." />
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {ADMIN_MODULES.map((m) => (
          <li key={m.href}>
            <Link href={m.href} className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-muted">
              <m.icon className="size-5 text-muted-foreground" aria-hidden />
              <span className="flex-1">{m.label}</span>
              {m.status === "planned" && <span className="text-xs text-muted-foreground">Fase {m.phase}</span>}
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
