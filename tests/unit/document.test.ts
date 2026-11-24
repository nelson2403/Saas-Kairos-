import { describe, expect, it } from "vitest";
import { formatDocument, isValidCnpj, isValidCpf, optionalDocumentSchema } from "@/lib/validations/document";

describe("CPF/CNPJ", () => {
  it("valida dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
    expect(isValidCnpj("00.000.000/0000-00")).toBe(false);
  });

  it("schema opcional normaliza e rejeita inválidos", () => {
    expect(optionalDocumentSchema.parse("")).toBeNull();
    expect(optionalDocumentSchema.parse(" 11.222.333/0001-81 ")).toBe("11222333000181");
    expect(optionalDocumentSchema.safeParse("123").success).toBe(false);
  });

  it("formata para exibição", () => {
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
  });
});
