import { Field, Input, Select } from "@/components/ui/input";
import { formatPhone, formatPostalCode, UF, type Address } from "@/modules/partners/domain";

type Errors = Record<string, string | undefined>;

/** Campos de endereço compartilhados (cliente e fornecedor). Funciona em formulários com FormData. */
export function AddressFields({ value, errors }: { value?: Partial<Address> | null; errors: Errors }) {
  return (
    <>
      <Field label="CEP" htmlFor="postal_code" error={errors.postal_code}>
        <Input id="postal_code" name="postal_code" inputMode="numeric" defaultValue={formatPostalCode(value?.postal_code)} maxLength={9} autoComplete="postal-code" />
      </Field>
      <Field label="Rua" htmlFor="street" error={errors.street}>
        <Input id="street" name="street" defaultValue={value?.street ?? ""} maxLength={160} autoComplete="address-line1" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Número" htmlFor="address_number" error={errors.address_number}>
          <Input id="address_number" name="address_number" defaultValue={value?.address_number ?? ""} maxLength={20} />
        </Field>
        <Field label="Complemento" htmlFor="complement" error={errors.complement}>
          <Input id="complement" name="complement" defaultValue={value?.complement ?? ""} maxLength={80} autoComplete="address-line2" />
        </Field>
      </div>
      <Field label="Bairro" htmlFor="district" error={errors.district}>
        <Input id="district" name="district" defaultValue={value?.district ?? ""} maxLength={80} />
      </Field>
      <div className="grid grid-cols-[1fr_6rem] gap-4">
        <Field label="Cidade" htmlFor="city" error={errors.city}>
          <Input id="city" name="city" defaultValue={value?.city ?? ""} maxLength={80} autoComplete="address-level2" />
        </Field>
        <Field label="UF" htmlFor="state" error={errors.state}>
          <Select id="state" name="state" defaultValue={value?.state ?? ""}>
            <option value="">—</option>
            {UF.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </>
  );
}

export function PhoneEmailFields({ phone, email, errors }: { phone?: string | null; email?: string | null; errors: Errors }) {
  return (
    <>
      <Field label="Telefone / WhatsApp" htmlFor="phone" error={errors.phone} hint="Com DDD.">
        <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={formatPhone(phone)} maxLength={20} autoComplete="tel" />
      </Field>
      <Field label="E-mail" htmlFor="email" error={errors.email}>
        <Input id="email" name="email" type="email" defaultValue={email ?? ""} maxLength={254} autoComplete="email" />
      </Field>
    </>
  );
}
