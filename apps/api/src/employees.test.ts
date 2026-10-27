import { describe, it, expect } from "vitest";
import { cleanEmployees, employeeSchema } from "./employees.js";

const header =
  "Nome;e-mail;Cidade;CPF;Centro de custo;Cargo atual;Data de desligamento";
describe("employee import cleaning", () => {
  it("keeps only active employees, normalizes fields and accepts blank email", () => {
    const result = cleanEmployees(
      Buffer.from(
        header +
          '\r\n" Ana ; Souza ";;Recife / pe;012.345.678-90; TI ; Analista ;\r\nDesligado;x@example.test;Recife / PE;;;Dev;26/10/2026',
      ),
    );
    expect(result.dismissed).toBe(1);
    expect(result.rows[0].data).toEqual({
      name: "Ana ; Souza",
      email: "",
      state: "PE",
      cpf: "01234567890",
      cost_center: "TI",
      job_name: "Analista",
    });
    expect(result.rows[0].errors).toEqual([]);
  });
  it("marks repeated CPF and email without discarding the first occurrence", () => {
    const result = cleanEmployees(
      Buffer.from(
        header +
          "\nAna;A@example.test;Recife / PE;01234567890;TI;Dev;\nBia;a@example.test;Recife / PE;01234567890;TI;Dev;",
      ),
    );
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[1].errors.join(" ")).toMatch(/duplicado/i);
  });
  it("rejects missing mandatory headers, malformed quotes and unknown state", () => {
    expect(() => cleanEmployees(Buffer.from("Nome;CPF\nAna;123"))).toThrow(
      /colunas/i,
    );
    expect(() => cleanEmployees(Buffer.from(header + '\n"Ana'))).toThrow(
      /aspas/i,
    );
    expect(
      cleanEmployees(
        Buffer.from(header + "\nAna;;Recife / XX;01234567890;TI;Dev;"),
      ).rows[0].errors.length,
    ).toBeGreaterThan(0);
  });
  it("supports BOM, quoted newlines and Windows-1252 accents", () => {
    const result = cleanEmployees(
      Buffer.from(
        "\ufeff" + header + '\n"Ana\nSouza";;Recife / PE;01234567890;TI;Dev;',
      ),
    );
    expect(result.rows[0].data.name).toBe("Ana Souza");
    expect(
      cleanEmployees(
        Buffer.from(
          header + "\nJoão;;Recife / PE;01234567890;TI;Dev;",
          "latin1",
        ),
      ).rows[0].data.name,
    ).toBe("João");
  });
  it("does not invent email and preserves leading CPF zeroes", () => {
    expect(
      employeeSchema.parse({ name: "Ana", email: "", cpf: "012.345.678-90" })
        .cpf,
    ).toBe("01234567890");
    expect(
      employeeSchema.safeParse({ name: "Ana", email: "invalid" }).success,
    ).toBe(false);
  });
});
