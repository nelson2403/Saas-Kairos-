"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { useOffline } from "next/offline";
import { placeOrderAction } from "@/app/(store)/actions";
import { useQuote } from "@/components/store/use-quote";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldError, Input, Select, Textarea } from "@/components/ui/input";
import { formatMoney } from "@/modules/inventory/domain";
import { UF } from "@/modules/partners/domain";
import type { StoreSettings } from "@/modules/store/domain";

export function CheckoutForm({ settings }: { settings: StoreSettings }) {
  const router = useRouter();
  const isOffline = useOffline();
  const { cart, items, loading, subtotal, problems, ready } = useQuote();
  // mesma chave em reenvios (rede instável, duplo clique): um único pedido
  const [key] = useState(() => crypto.randomUUID());
  const [method, setMethod] = useState<"retirada" | "entrega">(settings.pickup_enabled ? "retirada" : "entrega");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const shipping = method === "entrega" ? settings.delivery_fee : 0;
  const total = Math.round((subtotal + shipping) * 100) / 100;

  if (cart.lines.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Seu carrinho está vazio.</p>
        <Link href="/produtos" className={buttonVariants()}>
          Ver produtos
        </Link>
      </div>
    );
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "");
    setErrors({});
    setError(null);
    start(async () => {
      const result = await placeOrderAction({
        idempotency_key: key,
        name: s("name"),
        email: s("email"),
        phone: s("phone"),
        document: s("document"),
        method,
        postal_code: s("postal_code"),
        street: s("street"),
        address_number: s("address_number"),
        complement: s("complement"),
        district: s("district"),
        city: s("city"),
        state: s("state"),
        notes: s("notes"),
        whatsapp_opt_in: f.get("whatsapp_opt_in") === "on",
        marketing_opt_in: f.get("marketing_opt_in") === "on",
        privacy: f.get("privacy") === "on",
        website: s("website"),
        items: cart.lines.map((l) => ({ product_id: l.id, quantity: l.qty })),
      });
      if (result.ok) {
        cart.clear();
        router.push(`/pedido/${result.token}?novo=1`);
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setError(result.error ?? "Revise os campos destacados.");
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[1fr_22rem]" noValidate>
      <div className="space-y-8">
        <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 font-display text-2xl">Seus dados</legend>
          <Field label="Nome completo" htmlFor="name" error={errors.name} className="sm:col-span-2">
            <Input id="name" name="name" required maxLength={160} autoComplete="name" />
          </Field>
          <Field label="E-mail" htmlFor="email" error={errors.email}>
            <Input id="email" name="email" type="email" required maxLength={254} autoComplete="email" />
          </Field>
          <Field label="WhatsApp (com DDD)" htmlFor="phone" error={errors.phone}>
            <Input id="phone" name="phone" type="tel" inputMode="tel" required maxLength={20} autoComplete="tel" />
          </Field>
          <Field label="CPF (opcional)" htmlFor="document" error={errors.document} hint="Só se precisar de nota fiscal.">
            <Input id="document" name="document" inputMode="numeric" maxLength={18} />
          </Field>
          {/* campo invisível contra robôs */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
        </fieldset>

        <fieldset disabled={pending} className="space-y-4">
          <legend className="mb-3 font-display text-2xl">Recebimento</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {settings.pickup_enabled && (
              <label className={`flex cursor-pointer gap-3 rounded-md border p-4 text-sm ${method === "retirada" ? "border-foreground" : "border-border"}`}>
                <input type="radio" name="method" value="retirada" checked={method === "retirada"} onChange={() => setMethod("retirada")} className="mt-0.5 accent-tinta" />
                <span>
                  <strong className="block font-medium">Retirar</strong>
                  {settings.pickup_address ?? "Combinamos o local pelo WhatsApp."}
                </span>
              </label>
            )}
            {settings.delivery_enabled && (
              <label className={`flex cursor-pointer gap-3 rounded-md border p-4 text-sm ${method === "entrega" ? "border-foreground" : "border-border"}`}>
                <input type="radio" name="method" value="entrega" checked={method === "entrega"} onChange={() => setMethod("entrega")} className="mt-0.5 accent-tinta" />
                <span>
                  <strong className="block font-medium">Entrega · {settings.delivery_fee > 0 ? formatMoney(settings.delivery_fee) : "sem taxa"}</strong>
                  {settings.delivery_notes ?? "Entregamos no endereço informado."}
                </span>
              </label>
            )}
          </div>
          <FieldError message={errors.method} />
          {method === "entrega" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="CEP" htmlFor="postal_code" error={errors.postal_code}>
                <Input id="postal_code" name="postal_code" inputMode="numeric" maxLength={9} autoComplete="postal-code" required />
              </Field>
              <Field label="Rua" htmlFor="street" error={errors.street}>
                <Input id="street" name="street" maxLength={160} autoComplete="address-line1" required />
              </Field>
              <Field label="Número" htmlFor="address_number" error={errors.address_number}>
                <Input id="address_number" name="address_number" maxLength={20} required />
              </Field>
              <Field label="Complemento" htmlFor="complement">
                <Input id="complement" name="complement" maxLength={80} autoComplete="address-line2" />
              </Field>
              <Field label="Bairro" htmlFor="district" error={errors.district}>
                <Input id="district" name="district" maxLength={80} required />
              </Field>
              <div className="grid grid-cols-[1fr_6rem] gap-4">
                <Field label="Cidade" htmlFor="city" error={errors.city}>
                  <Input id="city" name="city" maxLength={80} autoComplete="address-level2" required />
                </Field>
                <Field label="UF" htmlFor="state" error={errors.state}>
                  <Select id="state" name="state" defaultValue="" required>
                    <option value="">—</option>
                    {UF.map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
          )}
          <Field label="Observações (opcional)" htmlFor="notes">
            <Textarea id="notes" name="notes" maxLength={1000} rows={2} placeholder="Presente, horário preferido…" />
          </Field>
        </fieldset>

        <fieldset disabled={pending} className="space-y-3 text-sm">
          <legend className="mb-3 font-display text-2xl">Privacidade</legend>
          <label className="flex items-start gap-3">
            <input type="checkbox" name="privacy" required className="mt-0.5 size-4 accent-tinta" />
            <span>
              Li e aceito a{" "}
              <Link href="/privacidade" target="_blank" className="underline">
                Política de Privacidade
              </Link>
              . Meus dados serão usados para processar e entregar este pedido.
            </span>
          </label>
          <FieldError message={errors.privacy} />
          <label className="flex items-start gap-3">
            <input type="checkbox" name="whatsapp_opt_in" className="mt-0.5 size-4 accent-tinta" />
            <span>Quero receber atualizações do pedido e novidades pelo WhatsApp (opcional).</span>
          </label>
          <label className="flex items-start gap-3">
            <input type="checkbox" name="marketing_opt_in" className="mt-0.5 size-4 accent-tinta" />
            <span>Quero receber promoções e lançamentos (opcional). Posso cancelar quando quiser.</span>
          </label>
        </fieldset>
      </div>

      <aside className="h-fit space-y-4 rounded-lg border border-border bg-surface p-5 lg:sticky lg:top-24">
        <h2 className="font-display text-2xl">Resumo</h2>
        <ul className="space-y-2 text-sm">
          {items.map(({ id, qty, info }) => (
            <li key={id} className="flex justify-between gap-3">
              <span>
                {qty}× {info?.name ?? "…"}
              </span>
              <span className="tabular-nums">{info ? formatMoney(Math.round(qty * info.price * 100) / 100) : ""}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t border-border pt-3 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{loading ? "…" : formatMoney(subtotal)}</dd>
          </div>
          {method === "entrega" && (
            <div className="flex justify-between">
              <dt>Entrega</dt>
              <dd className="tabular-nums">{formatMoney(shipping)}</dd>
            </div>
          )}
          <div className="flex justify-between text-lg">
            <dt>Total</dt>
            <dd className="tabular-nums">{loading ? "…" : formatMoney(total)}</dd>
          </div>
        </dl>
        <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Pagamento</p>
          <p className="whitespace-pre-line">{settings.payment_instructions}</p>
          <p className="mt-2">Os produtos ficam reservados por {settings.reservation_hours} h aguardando o pagamento.</p>
        </div>
        {problems.length > 0 && (
          <p className="text-sm text-danger">
            Alguns itens mudaram de disponibilidade.{" "}
            <Link href="/carrinho" className="underline">
              Ajuste o carrinho
            </Link>
            .
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={pending || !ready || loading || problems.length > 0 || isOffline}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Lock aria-hidden />}
          Confirmar pedido
        </Button>
        {isOffline && <p className="text-sm text-warning">Sem conexão. O pedido só é enviado com internet.</p>}
        <FieldError message={error ?? undefined} />
      </aside>
    </form>
  );
}
