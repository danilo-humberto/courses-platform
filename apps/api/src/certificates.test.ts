import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  certificateSchema,
  renderCertificate,
  fieldText,
} from "./certificates.js";

const field = {
  key: "nome",
  x: 0.1,
  y: 0.3,
  width: 0.8,
  size: 24,
  color: "#152D40",
  align: "center",
};
describe("certificados", () => {
  it("rejeita campo alto demais mesmo quando o texto longo reduz a fonte", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([842, 595]);
    const bytes = await pdf.save();
    const config = certificateSchema.parse({
      hours: "",
      fields: [{ ...field, y: 0.05, width: 0.4, size: 72 }],
    });
    for (const nome of ["Ana", "Maria Exemplo da Silva", "@".repeat(120)])
      await expect(renderCertificate(bytes, config, { nome })).rejects.toThrow(
        "Campo fora da página",
      );
  });
  it("valida posições, variáveis e presença do nome", () => {
    expect(
      certificateSchema.safeParse({ hours: "4 horas", fields: [field] })
        .success,
    ).toBe(true);
    for (const change of [
      { key: "senha" },
      { x: 0.9 },
      { size: 0 },
      { color: "red" },
      { y: -1 },
    ]) {
      expect(
        certificateSchema.safeParse({
          hours: "4 horas",
          fields: [{ ...field, ...change }],
        }).success,
      ).toBe(false);
    }
    expect(
      certificateSchema.safeParse({ hours: "4 horas", fields: [] }).success,
    ).toBe(false);
  });
  it("omite o rótulo de CPF ausente e formata CPF existente", () => {
    expect(fieldText("cpf", { nome: "Ana" })).toBe("");
    expect(fieldText("cpf", { cpf: "00000000000" })).toBe(
      "CPF: 000.000.000-00",
    );
  });
  it("gera PDF com nome longo e acentos, sem alterar o modelo", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([842, 595]);
    const source = await pdf.save();
    const config = certificateSchema.parse({
      hours: "4 horas",
      fields: [field],
    });
    const result = await renderCertificate(source, config, {
      nome: "Maria da Conceição ".repeat(6),
    });
    expect((await PDFDocument.load(result)).getPageCount()).toBe(1);
    expect(result.length).toBeGreaterThan(source.length);
  });
  it("recusa modelo com várias páginas", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    await expect(
      renderCertificate(
        await pdf.save(),
        certificateSchema.parse({ hours: "", fields: [field] }),
        { nome: "Ana" },
      ),
    ).rejects.toThrow("uma página");
  });
  it("recusa PDF recortado para evitar diferença entre prévia e emissão", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([842, 595]).setCropBox(50, 50, 700, 450);
    await expect(
      renderCertificate(
        await pdf.save(),
        certificateSchema.parse({ hours: "", fields: [field] }),
        { nome: "Ana" },
      ),
    ).rejects.toThrow("recorte");
  });
  it("acomoda UUID real em campo estreito com quebra de linha", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([842, 595]);
    const config = certificateSchema.parse({
      hours: "",
      fields: [
        field,
        { ...field, key: "codigo_certificado", y: 0.8, width: 0.1, size: 9 },
      ],
    });
    expect(
      (
        await renderCertificate(await pdf.save(), config, {
          nome: "W".repeat(120),
          codigo_certificado: "11111111-1111-4111-8111-111111111111",
        })
      ).length,
    ).toBeGreaterThan(0);
  });
});
