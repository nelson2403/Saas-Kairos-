"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { ADMIN_MODULES, MOBILE_NAV } from "@/config/modules";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils/cn";

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Menu lateral (tablet/desktop). */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-20 items-center justify-center border-b border-border">
        <Link href="/admin" aria-label="Kairós — início">
          <Logo />
        </Link>
      </div>
      <nav aria-label="Módulos" className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {ADMIN_MODULES.map((m) => {
            const active = isActive(pathname, m.href);
            return (
              <li key={m.href}>
                <Link
                  href={m.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <m.icon className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1 truncate">{m.label}</span>
                  {m.status === "planned" && (
                    <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground/80">Fase {m.phase}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

/** Navegação inferior (celular): Início, Estoque, Produção, Pedidos, Mais. */
export function BottomNav() {
  const pathname = usePathname();
  const items = [...MOBILE_NAV, { label: "Mais", href: "/admin/mais", icon: MoreHorizontal }];
  const mainHrefs: string[] = MOBILE_NAV.map((i) => i.href);
  return (
    <nav
      aria-label="Navegação principal"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active =
            item.href === "/admin/mais"
              ? pathname === "/admin/mais" || !mainHrefs.some((h) => isActive(pathname, h))
              : isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[0.7rem]",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                <item.icon className={cn("size-5", active && "stroke-[2.25]")} aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
