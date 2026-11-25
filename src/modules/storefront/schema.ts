import { z } from "zod";

/**
 * Documento de personalização da loja (rascunho e publicado têm o mesmo
 * formato). Tudo é validado ao salvar E ao exibir: um campo inválido volta
 * ao padrão em vez de quebrar a loja.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor no formato #RRGGBB.");

/** Link interno ("/produtos") ou externo https. Nada de javascript:, data: etc. */
export const safeLink = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || (v.startsWith("/") && !v.startsWith("//")) || /^https:\/\/[^\s<>"']+$/.test(v), "Use um link interno (/produtos) ou https://");

/** Arquivo do bucket store-assets da própria empresa. */
const assetPath = z
  .string()
  .regex(/^[0-9a-f-]{36}\/store\/[A-Za-z0-9._-]{1,120}$/, "Imagem inválida.")
  .nullable();

const text = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres.`);
const id = z.string().regex(/^[a-z0-9-]{6,40}$/);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "Data inválida.")
  .nullable();

export const DISPLAY_FONTS = { cormorant: "Cormorant Garamond", playfair: "Playfair Display", lora: "Lora" } as const;
export const RADIUS = { reto: "Retos", suave: "Suaves", redondo: "Arredondados" } as const;

export const themeSchema = z.object({
  background: hex,
  surface: hex,
  text: hex,
  muted_text: hex,
  accent: hex,
  accent_text: hex,
  display_font: z.enum(Object.keys(DISPLAY_FONTS) as [keyof typeof DISPLAY_FONTS, ...(keyof typeof DISPLAY_FONTS)[]]),
  radius: z.enum(Object.keys(RADIUS) as [keyof typeof RADIUS, ...(keyof typeof RADIUS)[]]),
});

const base = { id, visible: z.boolean() };

export const sectionSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("hero"),
    title: text(120),
    subtitle: text(300),
    button_text: text(40),
    button_link: safeLink,
    image_path: assetPath,
    show_logo: z.boolean(),
  }),
  z.object({ ...base, type: z.literal("featured"), title: text(80), limit: z.number().int().min(2).max(24), category_id: z.uuid().nullable() }),
  z.object({ ...base, type: z.literal("categories"), title: text(80) }),
  z.object({
    ...base,
    type: z.literal("banner"),
    image_path: assetPath,
    alt: text(160),
    link: safeLink,
    starts_at: isoDate,
    ends_at: isoDate,
  }),
  z.object({ ...base, type: z.literal("text"), title: text(120), body: text(2000) }),
]);
export type Section = z.infer<typeof sectionSchema>;
export type SectionType = Section["type"];

export const SECTION_LABEL: Record<SectionType, string> = {
  hero: "Destaque principal",
  featured: "Produtos em destaque",
  categories: "Categorias",
  banner: "Banner (imagem)",
  text: "Texto",
};

export const storefrontSchema = z.object({
  theme: themeSchema,
  brand: z.object({ logo_path: assetPath, show_tagline: z.boolean() }),
  announcement: z.object({ enabled: z.boolean(), text: text(160), link: safeLink }),
  sections: z.array(sectionSchema).max(20, "Máximo de 20 seções."),
  footer: z.object({
    about: text(500),
    instagram: z
      .string()
      .trim()
      .max(200)
      .refine((v) => v === "" || /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]+\/?$/.test(v), "Use o link do perfil: https://instagram.com/seuperfil"),
    show_whatsapp: z.boolean(),
  }),
  seo: z.object({ title: text(70), description: text(160) }),
});
export type Storefront = z.infer<typeof storefrontSchema>;

export const DEFAULT_STOREFRONT: Storefront = {
  theme: {
    background: "#f7f4ef",
    surface: "#fffdfa",
    text: "#34302c",
    muted_text: "#6b645d",
    accent: "#34302c",
    accent_text: "#f7f4ef",
    display_font: "cormorant",
    radius: "suave",
  },
  brand: { logo_path: null, show_tagline: true },
  announcement: { enabled: false, text: "", link: "" },
  sections: [
    { id: "hero-inicial", type: "hero", visible: true, title: "", subtitle: "", button_text: "Ver produtos", button_link: "/produtos", image_path: null, show_logo: true },
    { id: "categorias-inicial", type: "categories", visible: true, title: "" },
    { id: "novidades-inicial", type: "featured", visible: true, title: "Novidades", limit: 8, category_id: null },
  ],
  footer: { about: "", instagram: "", show_whatsapp: true },
  seo: { title: "Kairós — Onde o agora se torna abrigo", description: "Loja virtual da Kairós. Onde o agora se torna abrigo." },
};

/**
 * Lê um documento salvo de forma tolerante: cada bloco inválido volta ao
 * padrão e seções inválidas são descartadas (a loja nunca quebra).
 */
export function readStorefront(raw: unknown): Storefront {
  if (!raw || typeof raw !== "object") return DEFAULT_STOREFRONT;
  const r = raw as Record<string, unknown>;
  const pick = <T>(schema: z.ZodType<T>, value: unknown, fallback: T) => {
    const p = schema.safeParse(value);
    return p.success ? p.data : fallback;
  };
  const sections = Array.isArray(r.sections)
    ? r.sections.slice(0, 20).flatMap((s) => {
        const p = sectionSchema.safeParse(s);
        return p.success ? [p.data] : [];
      })
    : DEFAULT_STOREFRONT.sections;
  return {
    theme: pick(themeSchema, r.theme, DEFAULT_STOREFRONT.theme),
    brand: pick(storefrontSchema.shape.brand, r.brand, DEFAULT_STOREFRONT.brand),
    announcement: pick(storefrontSchema.shape.announcement, r.announcement, DEFAULT_STOREFRONT.announcement),
    sections,
    footer: pick(storefrontSchema.shape.footer, r.footer, DEFAULT_STOREFRONT.footer),
    seo: pick(storefrontSchema.shape.seo, r.seo, DEFAULT_STOREFRONT.seo),
  };
}

/** Nova seção com valores iniciais. */
export function newSection(type: SectionType): Section {
  const sid = `${type}-${Math.random().toString(36).slice(2, 10)}`;
  switch (type) {
    case "hero":
      return { id: sid, type, visible: true, title: "Título", subtitle: "", button_text: "Ver produtos", button_link: "/produtos", image_path: null, show_logo: false };
    case "featured":
      return { id: sid, type, visible: true, title: "Destaques", limit: 8, category_id: null };
    case "categories":
      return { id: sid, type, visible: true, title: "Categorias" };
    case "banner":
      return { id: sid, type, visible: true, image_path: null, alt: "", link: "", starts_at: null, ends_at: null };
    case "text":
      return { id: sid, type, visible: true, title: "Nossa história", body: "" };
  }
}

// ---------------------------------------------------------------------------
// Acessibilidade: contraste entre texto e fundo (WCAG)
// ---------------------------------------------------------------------------
function luminance(hexColor: string) {
  const n = parseInt(hexColor.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

/** Pares de cores que precisam de contraste mínimo (4,5:1 para texto). */
export function contrastWarnings(t: Storefront["theme"]) {
  const pairs: [string, string, string][] = [
    ["Texto sobre o fundo", t.text, t.background],
    ["Texto secundário sobre o fundo", t.muted_text, t.background],
    ["Texto sobre cartões", t.text, t.surface],
    ["Texto dos botões", t.accent_text, t.accent],
  ];
  return pairs.filter(([, a, b]) => contrastRatio(a, b) < 4.5).map(([label, a, b]) => `${label}: contraste ${contrastRatio(a, b).toLocaleString("pt-BR")}:1 (mínimo 4,5:1)`);
}

/** Banner dentro do período agendado? (datas em horário de Brasília). */
export function isScheduledNow(startsAt: string | null, endsAt: string | null, now: Date) {
  const toDate = (v: string, end: boolean) => new Date(v.length === 10 ? `${v}T${end ? "23:59:59" : "00:00:00"}-03:00` : `${v}-03:00`);
  if (startsAt && now < toDate(startsAt, false)) return false;
  if (endsAt && now > toDate(endsAt, true)) return false;
  return true;
}
