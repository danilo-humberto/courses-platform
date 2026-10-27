import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";

export const certificateKeys = [
  "nome",
  "cpf",
  "curso",
  "carga_horaria",
  "data_conclusao",
  "codigo_certificado",
] as const;
export const certificateSchema = z
  .object({
    hours: z.string().trim().max(60),
    fields: z
      .array(
        z
          .object({
            key: z.enum(certificateKeys),
            x: z.number().min(0).max(1),
            y: z.number().min(0.05).max(0.95),
            width: z.number().min(0.05).max(1),
            size: z.number().min(8).max(72),
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            align: z.enum(["left", "center", "right"]),
          })
          .refine((f) => f.x + f.width <= 1, "Campo fora da página"),
      )
      .min(1)
      .max(20),
  })
  .refine(
    (c) => c.fields.some((f) => f.key === "nome"),
    "Adicione o nome do participante",
  );
export type CertificateConfig = z.infer<typeof certificateSchema>;
export type CertificateValues = Partial<
  Record<(typeof certificateKeys)[number], string>
>;
export function fieldText(
  key: (typeof certificateKeys)[number],
  values: CertificateValues,
) {
  const value = values[key] ?? "";
  if (key === "cpf")
    return value
      ? `CPF: ${value.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")}`
      : "";
  if (key === "carga_horaria") return value ? `Carga horária: ${value}` : "";
  if (key === "data_conclusao") return value ? `Conclusão: ${value}` : "";
  if (key === "codigo_certificado") return value ? `Código: ${value}` : "";
  return value;
}
export async function loadTemplate(bytes: Uint8Array) {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch {
    throw new Error("PDF inválido ou protegido por senha.");
  }
  if (pdf.getPageCount() !== 1)
    throw new Error("O certificado deve ter uma página.");
  const page = pdf.getPages()[0];
  const media = page.getMediaBox(),
    crop = page.getCropBox();
  if (
    media.x !== 0 ||
    media.y !== 0 ||
    crop.x !== 0 ||
    crop.y !== 0 ||
    crop.width !== media.width ||
    crop.height !== media.height
  )
    throw new Error(
      "Use um PDF sem recorte de página. Exporte novamente com a página inteira.",
    );
  if (
    page.getRotation().angle !== 0 ||
    page.getWidth() > 2000 ||
    page.getHeight() > 2000 ||
    page.getWidth() < 200 ||
    page.getHeight() < 200
  )
    throw new Error(
      "Use um PDF sem rotação e com dimensões entre 200 e 2000 pontos.",
    );
  // Copy only the page artwork: forms, links and document actions are not part of a certificate.
  const clean = await PDFDocument.create();
  page.drawRectangle({ x: 0, y: 0, width: 1, height: 1, opacity: 0 });
  const embedded = await clean.embedPage(page);
  clean.addPage([page.getWidth(), page.getHeight()]).drawPage(embedded);
  return clean;
}
export async function renderCertificate(
  bytes: Uint8Array,
  config: CertificateConfig,
  values: CertificateValues,
) {
  const pdf = await loadTemplate(bytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.getPages()[0];
  for (const f of config.fields) {
    const baseline = page.getHeight() * (1 - f.y);
    // Validate the configured maximum, not just a long sample that shrinks:
    // short participant names must also fit. Reserve room for three 8pt lines.
    if (
      baseline + font.heightAtSize(f.size, { descender: false }) >
        page.getHeight() ||
      baseline < Math.max(f.size * 0.25, 21.2)
    )
      throw new Error(
        "Campo fora da página. Ajuste a posição vertical ou o tamanho da fonte.",
      );
    const text = fieldText(f.key, values).replace(/[\r\n\t]/g, " ");
    if (!text) continue;
    let measured: number;
    try {
      measured = font.widthOfTextAtSize(text, f.size);
    } catch {
      throw new Error(
        "O texto contém caracteres não suportados pela fonte do certificado.",
      );
    }
    const width = f.width * page.getWidth();
    const size = Math.max(
      8,
      measured > width ? (f.size * width) / measured : f.size,
    );
    const lines: string[] = [];
    let line = "";
    for (const char of text) {
      if (line && font.widthOfTextAtSize(line + char, size) > width) {
        lines.push(line.trim());
        line = "";
      }
      line += char;
    }
    if (line) lines.push(line.trim());
    if (lines.length > 3)
      throw new Error(
        "Texto muito longo. Aumente a largura do campo no modelo.",
      );
    if (
      baseline + font.heightAtSize(size, { descender: false }) >
        page.getHeight() ||
      baseline - (lines.length - 1) * size * 1.2 < size * 0.25
    )
      throw new Error(
        "Campo fora da página. Ajuste a posição vertical ou o tamanho da fonte.",
      );
    const color = [1, 3, 5].map(
      (i) => parseInt(f.color.slice(i, i + 2), 16) / 255,
    );
    for (const [index, line] of lines.entries()) {
      const actual = font.widthOfTextAtSize(line, size);
      const x =
        f.x * page.getWidth() +
        (f.align === "center"
          ? (width - actual) / 2
          : f.align === "right"
            ? width - actual
            : 0);
      page.drawText(line, {
        x,
        y: baseline - index * size * 1.2,
        size,
        font,
        color: rgb(color[0], color[1], color[2]),
      });
    }
  }
  pdf.setTitle("Certificado de conclusão");
  return pdf.save();
}
