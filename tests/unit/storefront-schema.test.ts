import { describe, expect, it } from "vitest";
import { DEFAULT_STOREFRONT, contrastRatio, contrastWarnings, isScheduledNow, newSection, readStorefront, storefrontSchema } from "@/modules/storefront/schema";

const company = "3f1c2a1e-8a0b-4c9e-9f6a-1b2c3d4e5f60";

describe("documento da loja", () => {
  it("o padrão é válido e cada tipo de seção nova também", () => {
    expect(storefrontSchema.safeParse(DEFAULT_STOREFRONT).success).toBe(true);
    for (const t of ["hero", "featured", "categories", "banner", "text"] as const) {
      expect(storefrontSchema.safeParse({ ...DEFAULT_STOREFRONT, sections: [newSection(t)] }).success).toBe(true);
    }
  });

  it("recusa cor fora do formato (sem injeção de CSS) e links perigosos", () => {
    const bad = (patch: object) => storefrontSchema.safeParse({ ...DEFAULT_STOREFRONT, ...patch }).success;
    expect(bad({ theme: { ...DEFAULT_STOREFRONT.theme, background: "red; } body { display:none" } })).toBe(false);
    for (const link of ["javascript:alert(1)", "//evil.com", "http://inseguro.com", "data:text/html,x"]) {
      expect(bad({ announcement: { enabled: true, text: "x", link } })).toBe(false);
    }
    expect(bad({ announcement: { enabled: true, text: "x", link: "/produtos" } })).toBe(true);
    expect(bad({ announcement: { enabled: true, text: "x", link: "https://exemplo.com/a" } })).toBe(true);
    expect(bad({ footer: { ...DEFAULT_STOREFRONT.footer, instagram: "https://evil.com/x" } })).toBe(false);
  });

  it("imagem só da pasta da loja da empresa", () => {
    const withLogo = (logo_path: string) => storefrontSchema.safeParse({ ...DEFAULT_STOREFRONT, brand: { logo_path, show_tagline: true } }).success;
    expect(withLogo(`${company}/store/logo.webp`)).toBe(true);
    expect(withLogo(`${company}/products/x/y.webp`)).toBe(false);
    expect(withLogo("../../segredo")).toBe(false);
  });

  it("leitura tolerante: bloco inválido volta ao padrão e seção inválida é descartada", () => {
    const r = readStorefront({
      theme: { background: "nope" },
      sections: [newSection("text"), { type: "desconhecida" }, { type: "banner", id: "x" }],
      seo: { title: "Minha loja", description: "" },
    });
    expect(r.theme).toEqual(DEFAULT_STOREFRONT.theme);
    expect(r.sections).toHaveLength(1);
    expect(r.seo.title).toBe("Minha loja");
    expect(readStorefront(null)).toEqual(DEFAULT_STOREFRONT);
  });
});

describe("acessibilidade e agenda", () => {
  it("contraste", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastWarnings(DEFAULT_STOREFRONT.theme)).toEqual([]);
    expect(contrastWarnings({ ...DEFAULT_STOREFRONT.theme, text: "#eeeeee" }).length).toBeGreaterThan(0);
  });

  it("banner agendado (horário de Brasília)", () => {
    const now = new Date("2026-12-10T15:00:00-03:00");
    expect(isScheduledNow(null, null, now)).toBe(true);
    expect(isScheduledNow("2026-12-01", "2026-12-10", now)).toBe(true); // até o fim do dia
    expect(isScheduledNow("2026-12-11", null, now)).toBe(false);
    expect(isScheduledNow(null, "2026-12-10T14:00", now)).toBe(false);
    expect(isScheduledNow("2026-12-10T15:00", "2026-12-10T16:00", now)).toBe(true);
  });
});
