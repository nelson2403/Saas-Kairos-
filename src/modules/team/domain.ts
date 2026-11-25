import type { RoleKey } from "@/lib/auth/dal";

export const ROLE_LABEL: Record<RoleKey, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  manager: "Gerente",
  operator: "Operador",
  viewer: "Leitura",
};

export const ROLE_HELP: Record<Exclude<RoleKey, "owner">, string> = {
  admin: "Tudo, inclusive equipe, loja e integrações (exceto transferir a propriedade).",
  manager: "Operação completa, relatórios, financeiro e estornos.",
  operator: "Estoque, produção, produtos e pedidos do dia a dia.",
  viewer: "Somente consulta.",
};

export const ASSIGNABLE_ROLES = ["admin", "manager", "operator", "viewer"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** O que o usuário atual pode conceder (administrador não concede administrador). */
export function grantableRoles(actor: RoleKey): AssignableRole[] {
  if (actor === "owner") return [...ASSIGNABLE_ROLES];
  if (actor === "admin") return ["manager", "operator", "viewer"];
  return [];
}

/** Pode mexer neste membro? (o banco confere de novo) */
export function canManage(actor: RoleKey, actorUserId: string, target: { user_id: string; role_key: RoleKey }) {
  if (actor !== "owner" && actor !== "admin") return false;
  if (target.user_id === actorUserId || target.role_key === "owner") return false;
  return !(actor === "admin" && target.role_key === "admin");
}

// Sem caracteres ambíguos (0/o, 1/l/i) — a senha é ditada ou digitada à mão.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Senha temporária forte (≈59 bits), formato xxxx-xxxx-xxxx. Sem viés de módulo. */
export function generateTempPassword(): string {
  const out: string[] = [];
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < 12) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    for (const b of bytes) {
      if (b < limit && out.length < 12) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return `${out.slice(0, 4).join("")}-${out.slice(4, 8).join("")}-${out.slice(8).join("")}`;
}
