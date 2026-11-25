"use server";

import { revalidatePath } from "next/cache";
import { addMember, resetMemberPassword, setMemberRole, setMemberStatus, transferOwnership } from "@/modules/team/service";

const done = <T extends { ok: boolean }>(r: T): T => {
  if (r.ok) revalidatePath("/admin/equipe");
  return r;
};

export async function addMemberAction(input: unknown) {
  return done(await addMember(input));
}
export async function setRoleAction(memberId: string, role: string) {
  return done(await setMemberRole(memberId, role));
}
export async function setStatusAction(memberId: string, status: "active" | "suspended") {
  return done(await setMemberStatus(memberId, status));
}
export async function transferAction(memberId: string) {
  return done(await transferOwnership(memberId));
}
export async function resetPasswordAction(memberId: string) {
  return resetMemberPassword(memberId);
}
