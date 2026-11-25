import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/table";
import { getTeam } from "@/modules/team/service";
import { grantableRoles } from "@/modules/team/domain";
import { AddMemberForm, MemberList } from "./team-manager";

export const metadata: Metadata = { title: "Equipe" };

export default function TeamPage() {
  return (
    <>
      <PageHeader title="Equipe" description="Quem acessa o sistema e o que cada pessoa pode fazer." />
      <Suspense fallback={<SectionSkeleton lines={4} />}>
        <Team />
      </Suspense>
    </>
  );
}

async function Team() {
  const team = await getTeam();
  if (!team.canManage) {
    return <EmptyState title="Somente o proprietário ou um administrador gerencia a equipe." />;
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Adicionar pessoa</CardTitle>
        <CardDescription className="mb-5 mt-1">
          O sistema cria o acesso com uma senha temporária, mostrada uma única vez para você repassar. No primeiro login a pessoa
          cria a própria senha.
        </CardDescription>
        <AddMemberForm roles={grantableRoles(team.role)} />
      </Card>
      <Card>
        <CardTitle className="mb-3">Pessoas com acesso</CardTitle>
        <MemberList members={team.members} actorRole={team.role} actorUserId={team.userId} />
      </Card>
    </div>
  );
}
