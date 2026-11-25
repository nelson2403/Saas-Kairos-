import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMembership, requireRole, requireUser, type RoleKey } from "@/lib/auth/dal";
import { dbErrorMessage, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { ASSIGNABLE_ROLES, generateTempPassword } from "./domain";

export type TeamMember = {
  member_id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role_key: RoleKey;
  role_name: string;
  status: "active" | "suspended" | "invited";
  created_at: string;
};

export async function getTeam() {
  const { role, user } = await requireMembership();
  if (role !== "owner" && role !== "admin") return { canManage: false as const, role, userId: user.id, members: [] as TeamMember[] };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_team_members");
  if (error) throw new Error(dbErrorMessage(error));
  return { canManage: true as const, role, userId: user.id, members: (data ?? []) as TeamMember[] };
}

const addSchema = z.object({
  full_name: z.string().trim().min(2, "Informe o nome.").max(120, "Nome muito longo."),
  email: z.string().trim().toLowerCase().max(254, "E-mail muito longo.").pipe(z.email("Informe um e-mail válido.")),
  role: z.enum(ASSIGNABLE_ROLES, "Escolha o papel."),
});

const uuid = z.uuid();

/**
 * Cria a conta de login (chave secreta, só no servidor) com senha temporária e
 * vincula à empresa. Se o e-mail já tem conta, apenas vincula (a senha dela não muda).
 * A senha temporária volta UMA vez para a tela e não é registrada em lugar nenhum.
 */
export async function addMember(input: unknown): Promise<ActionResult<{ tempPassword: string | null; email: string }>> {
  await requireRole(["owner", "admin"]);
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Revise os campos destacados.", fieldErrors: toFieldErrors(parsed.error.issues) };
  const { email, full_name, role } = parsed.data;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: "O servidor não está configurado para criar acessos (chave secreta ausente na Vercel)." };
  }

  const tempPassword = generateTempPassword();
  let createdId: string | null = null;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name },
    app_metadata: { must_change_password: true },
  });
  if (createError) {
    const exists = createError.code === "email_exists" || createError.code === "user_already_exists" || /already (been )?registered/i.test(createError.message);
    if (!exists) {
      console.error("team.addMember: falha ao criar conta", createError.code ?? createError.status);
      return { ok: false, error: "Não foi possível criar o acesso. Tente novamente." };
    }
  } else {
    createdId = created.user.id;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_add_member", { p_email: email, p_role: role, p_full_name: full_name });
  if (error) {
    // não deixa conta órfã quando o vínculo é recusado
    if (createdId) await admin.auth.admin.deleteUser(createdId);
    return { ok: false, error: dbErrorMessage(error) };
  }
  return {
    ok: true,
    message: createdId ? "Acesso criado." : "Esta pessoa já tinha conta e foi adicionada à equipe com a senha que já usa.",
    data: { tempPassword: createdId ? tempPassword : null, email },
  };
}

export async function setMemberRole(memberId: string, role: string): Promise<ActionResult> {
  await requireRole(["owner", "admin"]);
  if (!uuid.safeParse(memberId).success) return { ok: false, error: "Pessoa inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_set_member_role", { p_member: memberId, p_role: role });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Papel alterado." };
}

export async function setMemberStatus(memberId: string, status: "active" | "suspended"): Promise<ActionResult> {
  await requireRole(["owner", "admin"]);
  if (!uuid.safeParse(memberId).success) return { ok: false, error: "Pessoa inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_set_member_status", { p_member: memberId, p_status: status });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: status === "active" ? "Acesso reativado." : "Acesso suspenso. A pessoa não vê mais nenhum dado." };
}

export async function transferOwnership(memberId: string): Promise<ActionResult> {
  await requireRole(["owner"]);
  if (!uuid.safeParse(memberId).success) return { ok: false, error: "Pessoa inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_transfer_ownership", { p_member: memberId });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Propriedade transferida. Você agora é administrador." };
}

/** Nova senha temporária para quem esqueceu a senha. O banco decide se o usuário atual pode. */
export async function resetMemberPassword(memberId: string): Promise<ActionResult<{ tempPassword: string }>> {
  await requireRole(["owner", "admin"]);
  if (!uuid.safeParse(memberId).success) return { ok: false, error: "Pessoa inválida." };
  const supabase = await createClient();
  const { data: userId, error } = await supabase.rpc("fn_member_user_for_admin", { p_member: memberId });
  if (error || !userId) return { ok: false, error: dbErrorMessage(error) };
  const tempPassword = generateTempPassword();
  try {
    const { error: updError } = await createAdminClient().auth.admin.updateUserById(userId as string, {
      password: tempPassword,
      app_metadata: { must_change_password: true },
    });
    if (updError) throw updError;
  } catch {
    return { ok: false, error: "Não foi possível redefinir a senha. Tente novamente." };
  }
  return { ok: true, message: "Senha temporária gerada.", data: { tempPassword } };
}

const passwordSchema = z
  .object({
    password: z.string().min(10, "Use pelo menos 10 caracteres.").max(72, "Use no máximo 72 caracteres."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "As senhas não conferem." });

/** A própria pessoa troca a senha (obrigatório após senha temporária). */
export async function changeOwnPassword(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Revise os campos destacados.", fieldErrors: toFieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { ok: false, fieldErrors: { password: "Escolha uma senha diferente da atual." } };
    if (error.code === "weak_password") return { ok: false, fieldErrors: { password: "Senha fraca. Misture letras, números e símbolos." } };
    if (error.code === "reauthentication_needed") return { ok: false, error: "Por segurança, saia e entre novamente antes de trocar a senha." };
    return { ok: false, error: "Não foi possível trocar a senha. Tente novamente." };
  }

  if (user.mustChangePassword) {
    try {
      const { error: metaError } = await createAdminClient().auth.admin.updateUserById(user.id, {
        app_metadata: { must_change_password: null },
      });
      if (metaError) throw metaError;
    } catch {
      return { ok: false, error: "Senha trocada, mas não foi possível liberar o acesso. Avise o administrador." };
    }
    // novo token já sem a marcação
    await supabase.auth.refreshSession();
  }
  return { ok: true, message: "Senha alterada." };
}
