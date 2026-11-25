import { describe, expect, it } from "vitest";
import { canManage, generateTempPassword, grantableRoles } from "@/modules/team/domain";

describe("equipe (regras da tela)", () => {
  it("papéis que cada um pode conceder", () => {
    expect(grantableRoles("owner")).toEqual(["admin", "manager", "operator", "viewer"]);
    expect(grantableRoles("admin")).toEqual(["manager", "operator", "viewer"]);
    expect(grantableRoles("manager")).toEqual([]);
  });

  it("quem pode ser gerenciado", () => {
    expect(canManage("owner", "me", { user_id: "x", role_key: "admin" })).toBe(true);
    expect(canManage("owner", "me", { user_id: "me", role_key: "owner" })).toBe(false);
    expect(canManage("admin", "me", { user_id: "x", role_key: "owner" })).toBe(false);
    expect(canManage("admin", "me", { user_id: "x", role_key: "admin" })).toBe(false);
    expect(canManage("admin", "me", { user_id: "x", role_key: "operator" })).toBe(true);
    expect(canManage("manager", "me", { user_id: "x", role_key: "viewer" })).toBe(false);
  });

  it("senha temporária: formato, sem caracteres ambíguos e sem repetição", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateTempPassword();
      expect(p).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});
