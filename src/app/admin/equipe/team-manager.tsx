"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Crown, KeyRound, Loader2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select } from "@/components/ui/input";
import type { RoleKey } from "@/lib/auth/dal";
import { ROLE_HELP, ROLE_LABEL, canManage, grantableRoles, type AssignableRole } from "@/modules/team/domain";
import type { TeamMember } from "@/modules/team/service";
import { addMemberAction, resetPasswordAction, setRoleAction, setStatusAction, transferAction } from "./actions";

type Feedback = { ok: boolean; text: string } | null;

/** Mostra a senha temporária uma única vez, com a mensagem pronta para repassar. */
function TempPassword({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const message = `Seu acesso ao sistema Kairós:\nEndereço: ${window.location.origin}/login\nE-mail: ${email}\nSenha temporária: ${password}\nNo primeiro acesso você vai criar a sua própria senha.`;
  return (
    <div role="status" className="space-y-3 rounded-md border border-warning/40 bg-warning/5 p-4 text-sm">
      <p className="font-medium">Anote ou copie agora: esta senha não será mostrada de novo.</p>
      <pre className="whitespace-pre-wrap rounded-md bg-surface p-3 font-mono text-[13px]">{message}</pre>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(message);
            setCopied(true);
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copiado" : "Copiar mensagem"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Já repassei
        </Button>
      </div>
    </div>
  );
}

export function AddMemberForm({ roles }: { roles: AssignableRole[] }) {
  const [pending, start] = useTransition();
  const [role, setRole] = useState<AssignableRole>(roles.includes("admin") ? "admin" : roles[0]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);

  function submit(form: HTMLFormElement) {
    const fd = new FormData(form);
    setErrors({});
    setFeedback(null);
    start(async () => {
      const r = await addMemberAction({ full_name: fd.get("full_name"), email: fd.get("email"), role });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        if (r.error) setFeedback({ ok: false, text: r.error });
        return;
      }
      form.reset();
      setFeedback({ ok: true, text: r.message ?? "Acesso criado." });
      if (r.data.tempPassword) setSecret({ email: r.data.email, password: r.data.tempPassword });
    });
  }

  return (
    <div className="space-y-4">
      <form
        className="grid gap-4 md:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
      >
        <Field label="Nome" htmlFor="tm-name" error={errors.full_name}>
          <Input id="tm-name" name="full_name" autoComplete="off" maxLength={120} required aria-invalid={!!errors.full_name} />
        </Field>
        <Field label="E-mail de acesso" htmlFor="tm-email" error={errors.email}>
          <Input id="tm-email" name="email" type="email" inputMode="email" autoComplete="off" required aria-invalid={!!errors.email} />
        </Field>
        <Field label="Papel" htmlFor="tm-role" hint={ROLE_HELP[role]} error={errors.role} className="md:col-span-2">
          <Select id="tm-role" value={role} onChange={(e) => setRole(e.target.value as AssignableRole)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="md:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
            Criar acesso
          </Button>
        </div>
      </form>
      {feedback && (feedback.ok ? <p className="text-sm text-success">{feedback.text}</p> : <FieldError message={feedback.text} />)}
      {secret && <TempPassword email={secret.email} password={secret.password} onClose={() => setSecret(null)} />}
    </div>
  );
}

export function MemberList({ members, actorRole, actorUserId }: { members: TeamMember[]; actorRole: RoleKey; actorUserId: string }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const roles = grantableRoles(actorRole);

  function run(id: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) {
    setBusy(id);
    setFeedback(null);
    start(async () => {
      const r = await fn();
      setFeedback({ ok: r.ok, text: r.ok ? (r.message ?? "Feito.") : (r.error ?? "Não foi possível concluir.") });
      if (r.ok) after?.();
      setBusy(null);
    });
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border">
        {members.map((m) => {
          const manageable = canManage(actorRole, actorUserId, m);
          const label = m.full_name || m.email;
          return (
            <li key={m.member_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-48 flex-1">
                <p className="font-medium">
                  {label}
                  {m.user_id === actorUserId && <span className="text-muted-foreground"> (você)</span>}
                </p>
                {m.full_name && <p className="text-sm text-muted-foreground">{m.email}</p>}
              </div>
              {manageable && m.status === "active" ? (
                <Select
                  aria-label={`Papel de ${label}`}
                  className="h-9 w-40"
                  value={m.role_key}
                  disabled={pending}
                  onChange={(e) => run(m.member_id, () => setRoleAction(m.member_id, e.target.value))}
                >
                  {!roles.includes(m.role_key as AssignableRole) && <option value={m.role_key}>{ROLE_LABEL[m.role_key]}</option>}
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge>
                  {m.role_key === "owner" && <Crown className="size-3" aria-hidden />}
                  {ROLE_LABEL[m.role_key]}
                </Badge>
              )}
              <Badge tone={m.status === "active" ? "success" : "danger"}>{m.status === "active" ? "Ativo" : "Suspenso"}</Badge>
              <div className="flex flex-wrap gap-1">
                {busy === m.member_id && <Loader2 className="size-4 animate-spin self-center" aria-label="Processando" />}
                {manageable && m.status === "active" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm(`Gerar uma nova senha temporária para ${label}? A senha atual deixa de funcionar.`)) return;
                      setBusy(m.member_id);
                      setFeedback(null);
                      start(async () => {
                        const r = await resetPasswordAction(m.member_id);
                        if (r.ok) setSecret({ email: m.email, password: r.data.tempPassword });
                        else setFeedback({ ok: false, text: r.error ?? "Não foi possível redefinir." });
                        setBusy(null);
                      });
                    }}
                  >
                    <KeyRound aria-hidden /> Nova senha
                  </Button>
                )}
                {manageable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      const suspend = m.status === "active";
                      if (suspend && !confirm(`Suspender o acesso de ${label}? A pessoa deixa de ver qualquer dado na hora.`)) return;
                      run(m.member_id, () => setStatusAction(m.member_id, suspend ? "suspended" : "active"));
                    }}
                  >
                    {m.status === "active" ? "Suspender" : "Reativar"}
                  </Button>
                )}
                {actorRole === "owner" && m.user_id !== actorUserId && m.status === "active" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      const typed = prompt(
                        `Transferir a propriedade do sistema para ${label}?\n\nA pessoa passa a ser proprietária do sistema e você vira administrador. Só ela poderá desfazer.\n\nPara confirmar, digite TRANSFERIR:`,
                      );
                      if (typed?.trim().toUpperCase() !== "TRANSFERIR") return;
                      run(m.member_id, () => transferAction(m.member_id), () => window.location.reload());
                    }}
                  >
                    <Crown aria-hidden /> Tornar proprietário
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {feedback && (feedback.ok ? <p className="text-sm text-success">{feedback.text}</p> : <FieldError message={feedback.text} />)}
      {secret && <TempPassword email={secret.email} password={secret.password} onClose={() => setSecret(null)} />}
    </div>
  );
}
