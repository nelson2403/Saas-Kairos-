"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Loader2, Plus, RefreshCw, Rocket, Save, Trash2, X } from "lucide-react";
import { useOffline } from "next/offline";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select, Textarea } from "@/components/ui/input";
import { ACCEPTED_IMAGE_TYPES, prepareImage } from "@/lib/images/prepare";
import { createClient } from "@/lib/supabase/client";
import { STORE_ASSETS_BUCKET, storeAssetFolder, storeAssetUrl } from "@/modules/storefront/assets";
import {
  DISPLAY_FONTS,
  RADIUS,
  SECTION_LABEL,
  contrastWarnings,
  newSection,
  type Section,
  type SectionType,
  type Storefront,
} from "@/modules/storefront/schema";
import { publishAction, saveDraftAction } from "./actions";

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

type Tab = "aparencia" | "inicio" | "rodape";
const TABS: { key: Tab; label: string }[] = [
  { key: "aparencia", label: "Aparência" },
  { key: "inicio", label: "Página inicial" },
  { key: "rodape", label: "Rodapé e SEO" },
];

const COLOR_FIELDS: { key: keyof Storefront["theme"]; label: string }[] = [
  { key: "background", label: "Fundo" },
  { key: "surface", label: "Cartões" },
  { key: "text", label: "Texto" },
  { key: "muted_text", label: "Texto secundário" },
  { key: "accent", label: "Botões e destaques" },
  { key: "accent_text", label: "Texto dos botões" },
];

export function StoreEditor({
  initial,
  companyId,
  canEdit,
  categories,
  draftUpdatedAt,
  publishedVersion,
  publishedAt,
}: {
  initial: Storefront;
  companyId: string;
  canEdit: boolean;
  categories: { id: string; name: string }[];
  draftUpdatedAt: string | null;
  publishedVersion: number | null;
  publishedAt: string | null;
}) {
  const isOffline = useOffline();
  const [config, setConfig] = useState<Storefront>(initial);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>("aparencia");
  const [open, setOpen] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [savedAt, setSavedAt] = useState(draftUpdatedAt);
  const [published, setPublished] = useState({ version: publishedVersion, at: publishedAt });
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const warnings = contrastWarnings(config.theme);

  // aviso ao sair com alterações não salvas
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function update(fn: (c: Storefront) => Storefront) {
    setConfig((c) => fn(c));
    setDirty(true);
    setFeedback(null);
  }
  const setTheme = (patch: Partial<Storefront["theme"]>) => update((c) => ({ ...c, theme: { ...c.theme, ...patch } }));
  const setSection = (id: string, patch: Partial<Section>) =>
    update((c) => ({ ...c, sections: c.sections.map((s) => (s.id === id ? ({ ...s, ...patch } as Section) : s)) }));
  const moveSection = (index: number, dir: -1 | 1) =>
    update((c) => {
      const next = [...c.sections];
      const [item] = next.splice(index, 1);
      next.splice(index + dir, 0, item);
      return { ...c, sections: next };
    });

  function save() {
    start(async () => {
      const r = await saveDraftAction(config);
      if (r.ok) {
        setDirty(false);
        setSavedAt(r.data.savedAt);
        setPreviewKey((k) => k + 1);
        setFeedback({ ok: true, text: "Rascunho salvo. A prévia foi atualizada." });
      } else setFeedback({ ok: false, text: r.error ?? "Não foi possível salvar." });
    });
  }

  function publish() {
    if (!confirm("Publicar? A loja passará a mostrar exatamente o que está no editor.")) return;
    start(async () => {
      const r = await publishAction(config, note);
      if (r.ok) {
        setDirty(false);
        setNote("");
        setSavedAt(new Date().toISOString());
        setPublished({ version: r.data.version, at: new Date().toISOString() });
        setPreviewKey((k) => k + 1);
        setFeedback({ ok: true, text: r.message ?? "Publicado." });
      } else setFeedback({ ok: false, text: r.error ?? "Não foi possível publicar." });
    });
  }

  return (
    <div className="space-y-4">
      <Card className="sticky top-16 z-20 flex flex-wrap items-center gap-3 py-3 md:top-20">
        <div className="mr-auto text-sm">
          {dirty ? (
            <Badge tone="warning">Alterações não salvas</Badge>
          ) : (
            <span className="text-muted-foreground">{savedAt ? `Rascunho salvo em ${dateTime.format(new Date(savedAt))}` : "Rascunho ainda não salvo"}</span>
          )}
          <span className="block text-xs text-muted-foreground">
            {published.version ? `No ar: versão ${published.version}${published.at ? ` (${dateTime.format(new Date(published.at))})` : ""}` : "Nada publicado: a loja usa a aparência padrão"}
          </span>
        </div>
        {canEdit ? (
          <>
            <Button variant="outline" onClick={save} disabled={pending || isOffline || !dirty}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              Salvar rascunho
            </Button>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota da versão (opcional)" maxLength={200} className="w-48" aria-label="Nota da versão" />
            <Button onClick={publish} disabled={pending || isOffline}>
              <Rocket aria-hidden /> Publicar
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Somente proprietário ou administrador personaliza a loja.</span>
        )}
        {feedback && (
          <p role={feedback.ok ? "status" : "alert"} className={`w-full text-sm ${feedback.ok ? "text-success" : "text-danger"}`}>
            {feedback.text}
          </p>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,28rem)_1fr]">
        <Card className="h-fit">
          <nav className="mb-4 flex gap-1 border-b border-border" aria-label="Seções do editor">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.key ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <fieldset disabled={!canEdit || pending} className="space-y-5">
            {tab === "aparencia" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {COLOR_FIELDS.map((f) => (
                    <ColorField key={f.key} label={f.label} value={config.theme[f.key] as string} onChange={(v) => setTheme({ [f.key]: v })} />
                  ))}
                </div>
                {warnings.length > 0 && (
                  <ul className="space-y-1 rounded-md bg-warning/10 p-3 text-xs text-warning">
                    {warnings.map((w) => (
                      <li key={w}>Pouco contraste — {w}</li>
                    ))}
                  </ul>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Fonte dos títulos" htmlFor="display_font">
                    <Select id="display_font" value={config.theme.display_font} onChange={(e) => setTheme({ display_font: e.target.value as Storefront["theme"]["display_font"] })}>
                      {Object.entries(DISPLAY_FONTS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Cantos" htmlFor="radius">
                    <Select id="radius" value={config.theme.radius} onChange={(e) => setTheme({ radius: e.target.value as Storefront["theme"]["radius"] })}>
                      {Object.entries(RADIUS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <ImageField
                  label="Logo (opcional)"
                  hint="PNG com fundo transparente fica melhor. Sem logo, a loja usa o nome em texto."
                  companyId={companyId}
                  value={config.brand.logo_path}
                  maxSide={800}
                  onChange={(v) => update((c) => ({ ...c, brand: { ...c.brand, logo_path: v } }))}
                />
                <Toggle label="Mostrar a frase “Onde o agora se torna abrigo” no destaque" checked={config.brand.show_tagline} onChange={(v) => update((c) => ({ ...c, brand: { ...c.brand, show_tagline: v } }))} />
                <div className="space-y-3 rounded-md border border-border p-3">
                  <Toggle label="Barra de aviso no topo" checked={config.announcement.enabled} onChange={(v) => update((c) => ({ ...c, announcement: { ...c.announcement, enabled: v } }))} />
                  {config.announcement.enabled && (
                    <>
                      <Field label="Texto do aviso" htmlFor="ann_text">
                        <Input id="ann_text" value={config.announcement.text} maxLength={160} onChange={(e) => update((c) => ({ ...c, announcement: { ...c.announcement, text: e.target.value } }))} placeholder="Ex.: Frete grátis na cidade acima de R$ 150" />
                      </Field>
                      <LinkField value={config.announcement.link} onChange={(v) => update((c) => ({ ...c, announcement: { ...c.announcement, link: v } }))} />
                    </>
                  )}
                </div>
              </>
            )}

            {tab === "inicio" && (
              <>
                <p className="text-sm text-muted-foreground">Seções da página inicial, de cima para baixo.</p>
                <ul className="space-y-2">
                  {config.sections.map((s, i) => (
                    <li key={s.id} className="rounded-md border border-border">
                      <div className="flex items-center gap-1 p-2">
                        <button type="button" className="mr-auto flex-1 text-left text-sm font-medium" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                          {SECTION_LABEL[s.type]}
                          {"title" in s && s.title ? <span className="font-normal text-muted-foreground"> · {s.title}</span> : null}
                          {!s.visible && <span className="font-normal text-muted-foreground"> (oculta)</span>}
                        </button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => moveSection(i, -1)} disabled={i === 0} aria-label="Mover para cima">
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => moveSection(i, 1)} disabled={i === config.sections.length - 1} aria-label="Mover para baixo">
                          <ArrowDown aria-hidden />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => setSection(s.id, { visible: !s.visible })} aria-label={s.visible ? "Ocultar seção" : "Mostrar seção"}>
                          {s.visible ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => confirm("Remover esta seção?") && update((c) => ({ ...c, sections: c.sections.filter((x) => x.id !== s.id) }))}
                          aria-label="Remover seção"
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                      {open === s.id && (
                        <div className="space-y-3 border-t border-border p-3">
                          <SectionFields section={s} companyId={companyId} categories={categories} onChange={(patch) => setSection(s.id, patch)} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <AddSection
                  disabled={config.sections.length >= 20}
                  onAdd={(type) => {
                    const s = newSection(type);
                    update((c) => ({ ...c, sections: [...c.sections, s] }));
                    setOpen(s.id);
                  }}
                />
              </>
            )}

            {tab === "rodape" && (
              <>
                <Field label="Sobre a loja (rodapé)" htmlFor="about">
                  <Textarea id="about" rows={3} maxLength={500} value={config.footer.about} onChange={(e) => update((c) => ({ ...c, footer: { ...c.footer, about: e.target.value } }))} />
                </Field>
                <Field label="Instagram" htmlFor="instagram" hint="Ex.: https://instagram.com/seuperfil">
                  <Input id="instagram" value={config.footer.instagram} maxLength={200} onChange={(e) => update((c) => ({ ...c, footer: { ...c.footer, instagram: e.target.value } }))} />
                </Field>
                <Toggle label="Mostrar link do WhatsApp (configurado em Configurações → Loja virtual)" checked={config.footer.show_whatsapp} onChange={(v) => update((c) => ({ ...c, footer: { ...c.footer, show_whatsapp: v } }))} />
                <div className="space-y-3 rounded-md border border-border p-3">
                  <p className="text-sm font-medium">Google e redes sociais (página inicial)</p>
                  <Field label={`Título (${config.seo.title.length}/70)`} htmlFor="seo_title">
                    <Input id="seo_title" maxLength={70} value={config.seo.title} onChange={(e) => update((c) => ({ ...c, seo: { ...c.seo, title: e.target.value } }))} />
                  </Field>
                  <Field label={`Descrição (${config.seo.description.length}/160)`} htmlFor="seo_description">
                    <Textarea id="seo_description" rows={2} maxLength={160} value={config.seo.description} onChange={(e) => update((c) => ({ ...c, seo: { ...c.seo, description: e.target.value } }))} />
                  </Field>
                </div>
              </>
            )}
          </fieldset>
        </Card>

        <Card className="h-fit p-0 xl:sticky xl:top-44">
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
            <span className="text-muted-foreground">Prévia do último rascunho salvo{dirty ? " (salve para ver as alterações)" : ""}</span>
            <Button variant="ghost" size="sm" onClick={() => setPreviewKey((k) => k + 1)}>
              <RefreshCw aria-hidden /> Atualizar
            </Button>
          </div>
          <iframe key={previewKey} src="/previa" title="Prévia da loja" className="h-[70vh] w-full rounded-b-lg bg-background" />
        </Card>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  // mantém o campo de texto em sincronia quando a cor muda pelo seletor
  if (/^#[0-9a-fA-F]{6}$/.test(text) && text.toLowerCase() !== value.toLowerCase()) setText(value);
  return (
    <label className="text-sm">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-10 shrink-0 cursor-pointer rounded-md border border-border bg-transparent" aria-label={label} />
        <Input
          value={text}
          maxLength={7}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          className="font-mono text-xs"
          aria-label={`${label} (hexadecimal)`}
        />
      </span>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-tinta" />
      <span>{label}</span>
    </label>
  );
}

function LinkField({ value, onChange, label = "Link (opcional)" }: { value: string; onChange: (v: string) => void; label?: string }) {
  const id = useId();
  const invalid = value !== "" && !((value.startsWith("/") && !value.startsWith("//")) || /^https:\/\/[^\s<>"']+$/.test(value));
  return (
    <Field label={label} htmlFor={id} error={invalid ? "Use um link da loja (ex.: /produtos) ou um endereço https://" : undefined}>
      <Input id={id} value={value} maxLength={300} onChange={(e) => onChange(e.target.value)} placeholder="/produtos" />
    </Field>
  );
}

function ImageField({
  label,
  hint,
  companyId,
  value,
  onChange,
  maxSide = 2000,
}: {
  label: string;
  hint?: string;
  companyId: string;
  value: string | null;
  onChange: (v: string | null) => void;
  maxSide?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return setError("Use JPG, PNG ou WebP.");
    setBusy(true);
    try {
      const { blob, ext, type } = await prepareImage(file, maxSide);
      const path = `${storeAssetFolder(companyId)}${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await createClient().storage.from(STORE_ASSETS_BUCKET).upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false });
      if (upErr) throw new Error("Falha no envio. Verifique a conexão.");
      onChange(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no envio.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2 text-sm">
      <span className="block text-muted-foreground">{label}</span>
      {value ? (
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-28 overflow-hidden rounded-md border border-border bg-muted">
            <Image src={storeAssetUrl(value)} alt="" fill sizes="112px" className="object-contain" />
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <X aria-hidden /> Remover
          </Button>
        </div>
      ) : null}
      <label className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 hover:bg-muted/50 ${busy ? "pointer-events-none opacity-60" : ""}`}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
        {busy ? "Enviando…" : value ? "Trocar imagem" : "Enviar imagem"}
        <input ref={input} type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} className="sr-only" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
      </label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError message={error ?? undefined} />
    </div>
  );
}

function AddSection({ onAdd, disabled }: { onAdd: (t: SectionType) => void; disabled: boolean }) {
  const [type, setType] = useState<SectionType>("featured");
  return (
    <div className="flex gap-2">
      <Select value={type} onChange={(e) => setType(e.target.value as SectionType)} aria-label="Tipo de seção">
        {(Object.keys(SECTION_LABEL) as SectionType[]).map((t) => (
          <option key={t} value={t}>
            {SECTION_LABEL[t]}
          </option>
        ))}
      </Select>
      <Button type="button" variant="outline" onClick={() => onAdd(type)} disabled={disabled}>
        <Plus aria-hidden /> Adicionar
      </Button>
    </div>
  );
}

function SectionFields({
  section: s,
  companyId,
  categories,
  onChange,
}: {
  section: Section;
  companyId: string;
  categories: { id: string; name: string }[];
  onChange: (patch: Partial<Section>) => void;
}) {
  const text = (key: string, label: string, max: number, multiline = false, placeholder?: string) => {
    const value = String((s as Record<string, unknown>)[key] ?? "");
    return (
      <Field label={label} htmlFor={`${s.id}-${key}`}>
        {multiline ? (
          <Textarea id={`${s.id}-${key}`} rows={4} maxLength={max} value={value} onChange={(e) => onChange({ [key]: e.target.value } as Partial<Section>)} placeholder={placeholder} />
        ) : (
          <Input id={`${s.id}-${key}`} maxLength={max} value={value} onChange={(e) => onChange({ [key]: e.target.value } as Partial<Section>)} placeholder={placeholder} />
        )}
      </Field>
    );
  };

  switch (s.type) {
    case "hero":
      return (
        <>
          <Toggle label="Mostrar a logo grande" checked={s.show_logo} onChange={(v) => onChange({ show_logo: v })} />
          {text("title", "Título", 120)}
          {text("subtitle", "Subtítulo", 300, true)}
          <div className="grid grid-cols-2 gap-3">
            {text("button_text", "Texto do botão", 40)}
            <LinkField label="Link do botão" value={s.button_link} onChange={(v) => onChange({ button_link: v })} />
          </div>
          <ImageField label="Imagem de fundo (opcional)" companyId={companyId} value={s.image_path} onChange={(v) => onChange({ image_path: v })} />
        </>
      );
    case "featured":
      return (
        <>
          {text("title", "Título", 80)}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantidade" htmlFor={`${s.id}-limit`}>
              <Input id={`${s.id}-limit`} type="number" min={2} max={24} value={s.limit} onChange={(e) => onChange({ limit: Math.max(2, Math.min(24, Number(e.target.value) || 8)) })} />
            </Field>
            <Field label="Categoria" htmlFor={`${s.id}-cat`}>
              <Select id={`${s.id}-cat`} value={s.category_id ?? ""} onChange={(e) => onChange({ category_id: e.target.value || null })}>
                <option value="">Mais recentes (todas)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </>
      );
    case "categories":
      return text("title", "Título (opcional)", 80);
    case "banner":
      return (
        <>
          <ImageField label="Imagem do banner" hint="Formato largo (ex.: 1600×500)." companyId={companyId} value={s.image_path} onChange={(v) => onChange({ image_path: v })} />
          {text("alt", "Descrição da imagem (acessibilidade)", 160)}
          <LinkField value={s.link} onChange={(v) => onChange({ link: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mostrar a partir de" htmlFor={`${s.id}-start`}>
              <Input id={`${s.id}-start`} type="datetime-local" value={s.starts_at ?? ""} onChange={(e) => onChange({ starts_at: e.target.value || null })} />
            </Field>
            <Field label="Mostrar até" htmlFor={`${s.id}-end`}>
              <Input id={`${s.id}-end`} type="datetime-local" value={s.ends_at ?? ""} onChange={(e) => onChange({ ends_at: e.target.value || null })} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">Horário de Brasília. Em branco = sempre visível.</p>
        </>
      );
    case "text":
      return (
        <>
          {text("title", "Título", 120)}
          {text("body", "Texto", 2000, true)}
        </>
      );
  }
}
