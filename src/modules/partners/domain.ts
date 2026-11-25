/** Formatação de contatos e endereço (exibição). O banco guarda só dígitos. */

export const UF = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR",
  "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

export function formatPhone(value: string | null | undefined) {
  if (!value) return "";
  const d = value.replace(/\D/g, "");
  // com DDI 55
  const local = d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return value;
}

export function formatPostalCode(value: string | null | undefined) {
  if (!value) return "";
  return value.length === 8 ? `${value.slice(0, 5)}-${value.slice(5)}` : value;
}

/** CPF parcialmente oculto para listas (LGPD: minimização na tela). */
export function maskDocument(value: string | null | undefined) {
  if (!value) return "";
  if (value.length === 11) return `***.${value.slice(3, 6)}.${value.slice(6, 9)}-**`;
  return value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

export type Address = {
  street: string | null;
  address_number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

export function formatAddress(a: Address) {
  const line1 = [a.street, a.address_number].filter(Boolean).join(", ");
  const line2 = [a.complement, a.district].filter(Boolean).join(" · ");
  const line3 = [[a.city, a.state].filter(Boolean).join("/"), formatPostalCode(a.postal_code)].filter(Boolean).join(" · ");
  return [line1, line2, line3].filter(Boolean);
}
