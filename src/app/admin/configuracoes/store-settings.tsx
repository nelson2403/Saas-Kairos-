"use client";

import { useActionState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { formatPhone } from "@/modules/partners/domain";
import type { StoreSettings } from "@/modules/store/domain";
import { saveStoreSettingsAction } from "./actions";

const money = (n: number) => n.toFixed(2).replace(".", ",");

export function StoreSettingsForm({ settings, canEdit }: { settings: StoreSettings; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveStoreSettingsAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="space-y-5">
      <fieldset disabled={!canEdit || pending} className="space-y-5">
        <label className="flex items-start gap-3 rounded-md border border-border p-4">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="mt-0.5 size-4 accent-tinta" />
          <span className="text-sm">
            <strong className="block font-medium">Loja aberta para pedidos</strong>
            Mostra os produtos marcados como “Exibir na loja virtual” e permite finalizar pedidos. Fechada, a loja mostra “em breve”.
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="WhatsApp da loja" htmlFor="store-whatsapp" error={errors.whatsapp} hint="Aparece no rodapé e no acompanhamento do pedido.">
            <Input id="store-whatsapp" name="whatsapp" type="tel" defaultValue={formatPhone(settings.whatsapp)} maxLength={20} />
          </Field>
          <Field label="Reserva do estoque (horas)" htmlFor="reservation_hours" error={errors.reservation_hours} hint="Sem pagamento nesse prazo, o pedido é cancelado e o estoque liberado.">
            <Input id="reservation_hours" name="reservation_hours" type="number" min={1} max={720} defaultValue={settings.reservation_hours} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3 rounded-md border border-border p-4">
            <label className="flex items-center gap-3 text-sm font-medium">
              <input type="checkbox" name="pickup_enabled" defaultChecked={settings.pickup_enabled} className="size-4 accent-tinta" />
              Retirada
            </label>
            <FieldError message={errors.pickup_enabled} />
            <Field label="Onde retirar" htmlFor="pickup_address" error={errors.pickup_address}>
              <Textarea id="pickup_address" name="pickup_address" rows={2} maxLength={300} defaultValue={settings.pickup_address ?? ""} placeholder="Endereço e horários" />
            </Field>
          </div>
          <div className="space-y-3 rounded-md border border-border p-4">
            <label className="flex items-center gap-3 text-sm font-medium">
              <input type="checkbox" name="delivery_enabled" defaultChecked={settings.delivery_enabled} className="size-4 accent-tinta" />
              Entrega
            </label>
            <Field label="Taxa de entrega (R$)" htmlFor="delivery_fee" error={errors.delivery_fee}>
              <Input id="delivery_fee" name="delivery_fee" inputMode="decimal" defaultValue={money(settings.delivery_fee)} />
            </Field>
            <Field label="Observação da entrega" htmlFor="delivery_notes" error={errors.delivery_notes}>
              <Input id="delivery_notes" name="delivery_notes" maxLength={300} defaultValue={settings.delivery_notes ?? ""} placeholder="Ex.: somente na cidade, em até 2 dias úteis" />
            </Field>
          </div>
        </div>

        <Field
          label="Como o cliente paga"
          htmlFor="payment_instructions"
          error={errors.payment_instructions}
          hint="Mostrado no checkout e no acompanhamento do pedido. O pagamento online (Pix/cartão automático) chega com a integração Asaas."
        >
          <Textarea id="payment_instructions" name="payment_instructions" rows={3} maxLength={1000} defaultValue={settings.payment_instructions} />
        </Field>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Salvar loja
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Somente proprietário ou administrador altera a loja.</p>
        )}
        <a href="/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          Ver loja <ExternalLink className="size-3.5" aria-hidden />
        </a>
        {state?.ok && <p role="status" className="text-sm text-success">{state.message}</p>}
        {state && !state.ok && (state.error || Object.keys(errors).length > 0) && <FieldError message={state.error ?? "Revise os campos destacados."} />}
      </div>
    </form>
  );
}
