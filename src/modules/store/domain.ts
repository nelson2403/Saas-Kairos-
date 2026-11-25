/** Regras e tipos da loja pública (sem acesso a banco). */

export type StoreSettings = {
  company_name: string;
  enabled: boolean;
  whatsapp: string | null;
  pickup_enabled: boolean;
  pickup_address: string | null;
  delivery_enabled: boolean;
  delivery_fee: number;
  delivery_notes: string | null;
  payment_instructions: string;
  reservation_hours: number;
};

export type StoreProductCard = {
  id: string;
  slug: string;
  name: string;
  price: number;
  category_id: string | null;
  category_name: string | null;
  image_path: string | null;
  available: number;
};

export type StoreProductDetail = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  sku: string | null;
  unit: string;
  category: { id: string; name: string } | null;
  available: number;
  images: { path: string; alt: string | null }[];
  updated_at: string;
};

export type CartLine = { id: string; qty: number };
export const CART_STORAGE_KEY = "kairos-cart-v1";
/** Máximo por item no carrinho (proteção contra erro de digitação). */
export const MAX_QTY_PER_ITEM = 50;

/** Carrinho salvo no aparelho: valida o formato e descarta o que estiver estranho. */
export function parseCart(raw: string | null): CartLine[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    return data
      .filter((l): l is CartLine => typeof l?.id === "string" && /^[0-9a-f-]{36}$/.test(l.id) && Number.isInteger(l.qty) && l.qty > 0)
      .filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)))
      .map((l) => ({ id: l.id, qty: Math.min(l.qty, MAX_QTY_PER_ITEM) }))
      .slice(0, 50);
  } catch {
    return [];
  }
}

export function availabilityLabel(available: number): { text: string; tone: "success" | "warning" | "danger" } {
  if (available <= 0) return { text: "Esgotado", tone: "danger" };
  if (available <= 3) return { text: `Últimas ${Math.floor(available)} unidades`, tone: "warning" };
  return { text: "Em estoque", tone: "success" };
}

/** Link do WhatsApp (somente dígitos; adiciona 55 se vier sem DDI). */
export function whatsappLink(phone: string | null | undefined, text?: string) {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  const full = d.length <= 11 ? `55${d}` : d;
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export const DELIVERY_LABEL = { retirada: "Retirada", entrega: "Entrega" } as const;

export const STORE_ORDER_STATUS: Record<string, { label: string; text: string }> = {
  pending: { label: "Aguardando pagamento", text: "Recebemos seu pedido. Os produtos estão reservados até a confirmação do pagamento." },
  paid: { label: "Pagamento confirmado", text: "Pagamento confirmado. Estamos preparando seu pedido." },
  delivered: { label: "Entregue", text: "Pedido entregue. Obrigado pela compra!" },
  canceled: { label: "Cancelado", text: "Este pedido foi cancelado." },
  refunded: { label: "Estornado", text: "Este pedido foi estornado." },
};
