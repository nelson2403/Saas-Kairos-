import {
  LayoutDashboard,
  Package,
  FlaskConical,
  Factory,
  Warehouse,
  ArrowLeftRight,
  ShoppingCart,
  BadgeDollarSign,
  ClipboardList,
  Users,
  Truck,
  Wallet,
  BarChart3,
  Store,
  Plug,
  Settings,
  Activity,
  type LucideIcon,
} from "lucide-react";

export type ModuleStatus = "available" | "planned";

export type AdminModule = {
  slug: string;
  label: string;
  href: string;
  icon: LucideIcon;
  phase: number;
  status: ModuleStatus;
  summary: string;
};

/**
 * Fonte única dos módulos do painel. `status: "planned"` leva à página de status
 * do módulo (o que vem e em qual fase) — nunca a uma tela de mentira.
 * Ao entregar um módulo: criar app/admin/<slug>/page.tsx e mudar para "available".
 */
export const ADMIN_MODULES: AdminModule[] = [
  { slug: "", label: "Dashboard", href: "/admin", icon: LayoutDashboard, phase: 1, status: "available", summary: "Visão geral da operação." },
  { slug: "produtos", label: "Produtos", href: "/admin/produtos", icon: Package, phase: 2, status: "available", summary: "Cadastro, fotos, preços, margem, código de barras e disponibilidade na loja." },
  { slug: "materias-primas", label: "Matérias-primas", href: "/admin/materias-primas", icon: FlaskConical, phase: 2, status: "available", summary: "Insumos, unidades, conversões e estoque mínimo." },
  { slug: "producao", label: "Produção", href: "/admin/producao", icon: Factory, phase: 3, status: "available", summary: "Fichas técnicas, ordens de produção, custos, perdas e estornos." },
  { slug: "estoque", label: "Estoque", href: "/admin/estoque", icon: Warehouse, phase: 2, status: "available", summary: "Saldos de produtos acabados e matérias-primas, entradas, saídas, ajustes e inventário." },
  { slug: "movimentacoes", label: "Movimentações", href: "/admin/movimentacoes", icon: ArrowLeftRight, phase: 2, status: "available", summary: "Histórico auditável de todas as movimentações de estoque." },
  { slug: "compras", label: "Compras", href: "/admin/compras", icon: ShoppingCart, phase: 4, status: "planned", summary: "Pedidos de compra e recebimentos que geram entrada de estoque." },
  { slug: "vendas", label: "Vendas", href: "/admin/vendas", icon: BadgeDollarSign, phase: 5, status: "planned", summary: "Vendas manuais e vendas efetivadas da loja." },
  { slug: "pedidos", label: "Pedidos", href: "/admin/pedidos", icon: ClipboardList, phase: 5, status: "planned", summary: "Pedidos, status, reservas de estoque e histórico." },
  { slug: "clientes", label: "Clientes", href: "/admin/clientes", icon: Users, phase: 4, status: "planned", summary: "Cadastro, histórico de compras, indicadores e consentimentos (LGPD)." },
  { slug: "fornecedores", label: "Fornecedores", href: "/admin/fornecedores", icon: Truck, phase: 4, status: "planned", summary: "Cadastro de fornecedores e histórico de compras." },
  { slug: "financeiro", label: "Financeiro", href: "/admin/financeiro", icon: Wallet, phase: 5, status: "planned", summary: "Contas a pagar e receber, recebimentos, despesas e fluxo de caixa." },
  { slug: "relatorios", label: "Relatórios", href: "/admin/relatorios", icon: BarChart3, phase: 5, status: "planned", summary: "Relatórios com exportação em PDF e Excel." },
  { slug: "loja", label: "Loja virtual", href: "/admin/loja", icon: Store, phase: 6, status: "planned", summary: "Loja pública e o editor Personalizar Minha Loja (Fase 7)." },
  { slug: "integracoes", label: "Integrações", href: "/admin/integracoes", icon: Plug, phase: 8, status: "planned", summary: "Asaas (Fase 8) e WhatsApp via Evolution API (Fase 9)." },
  { slug: "configuracoes", label: "Configurações", href: "/admin/configuracoes", icon: Settings, phase: 1, status: "available", summary: "Dados da empresa e preferências." },
  { slug: "status", label: "Status do app", href: "/admin/status", icon: Activity, phase: 1, status: "available", summary: "Conexão, sincronização, instalação e versão." },
];

export const PLANNED_MODULES = ADMIN_MODULES.filter((m) => m.status === "planned");

export function findModule(slug: string) {
  return ADMIN_MODULES.find((m) => m.slug === slug);
}

/** Itens fixos da navegação inferior no celular. */
export const MOBILE_NAV = [
  { label: "Início", href: "/admin", icon: LayoutDashboard },
  { label: "Estoque", href: "/admin/estoque", icon: Warehouse },
  { label: "Produção", href: "/admin/producao", icon: Factory },
  { label: "Pedidos", href: "/admin/pedidos", icon: ClipboardList },
] as const;
