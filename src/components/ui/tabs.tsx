import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/** Abas como links (estado na URL, funciona sem JavaScript). */
export function LinkTabs({ items, active }: { items: { href: string; label: string; key: string }[]; active: string }) {
  return (
    // Linha de base como sombra interna (não como borda + margem negativa): assim nada
    // transborda na vertical e o contêiner com rolagem horizontal não mostra barra vertical.
    <nav
      className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:thin]"
      aria-label="Filtros"
    >
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === active ? "page" : undefined}
          className={cn(
            "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm",
            i.key === active ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
