import { z } from "zod";

const states = new Set(
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(
    " ",
  ),
);
const compact = (value: string) => value.trim().replace(/\s+/g, " ");
export const employeeSchema = z.object({
  name: z.string().transform(compact).pipe(z.string().min(1).max(120)),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .default("")
    .pipe(z.union([z.literal(""), z.email()])),
  cpf: z
    .string()
    .default("")
    .transform((v) => v.replace(/[.\-\s]/g, ""))
    .pipe(z.string().regex(/^\d{11}$/, "CPF deve conter 11 dígitos.")),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .default("")
    .refine((v) => !v || states.has(v), "Estado inválido."),
  cost_center: z
    .string()
    .transform(compact)
    .pipe(z.string().max(160))
    .default(""),
  job_name: z.string().transform(compact).pipe(z.string().max(120)).default(""),
});
export type Employee = z.infer<typeof employeeSchema>;
export type ImportRow = { row: number; data: Employee; errors: string[] };

function parseCsv(text: string): string[][] {
  const delimiter = text.split(/\r?\n/, 1)[0].includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === delimiter || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== delimiter) {
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error("CSV com aspas inválidas.");
      cell += c;
    }
    if (rows.length > 10000 || cell.length > 20000)
      throw new Error(
        "CSV excede o limite de 10.000 registros ou de tamanho por campo.",
      );
  }
  if (quoted) throw new Error("CSV com aspas não fechadas.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

export function cleanEmployees(buffer: Buffer) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder("windows-1252").decode(buffer);
  }
  const [header, ...records] = parseCsv(text.replace(/^\uFEFF/, ""));
  const normalize = (v: string) =>
    compact(v)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const columns = header?.map(normalize) ?? [];
  const required = [
    "nome",
    "e-mail",
    "cidade",
    "cpf",
    "centro de custo",
    "cargo atual",
    "data de desligamento",
  ];
  // The supplied HR export uses "Centro de custo".
  const aliases = columns;
  if (required.some((v) => aliases.filter((c) => c === v).length !== 1))
    throw new Error(
      "Confira as colunas obrigatórias: Nome, E-mail, Cidade, CPF, Centro de Custo, Cargo Atual e Data de desligamento.",
    );
  let dismissed = 0;
  const cpfs = new Set<string>(),
    emails = new Set<string>();
  const rows: ImportRow[] = [];
  for (const [index, cells] of records.entries()) {
    const get = (key: string) => cells[aliases.indexOf(key)]?.trim() ?? "";
    if (get("data de desligamento")) {
      dismissed++;
      continue;
    }
    const raw = {
      name: compact(get("nome")),
      email: get("e-mail").toLowerCase(),
      cpf: get("cpf").replace(/[.\-\s]/g, ""),
      state:
        get("cidade")
          .match(/\/\s*([a-z]{2})\s*$/i)?.[1]
          ?.toUpperCase() ?? "",
      cost_center: compact(get("centro de custo")),
      job_name: compact(get("cargo atual")),
    };
    const parsed = employeeSchema.safeParse(raw);
    const errors = parsed.success
      ? []
      : parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`);
    if (cells.length !== columns.length)
      errors.push("Quantidade de colunas diferente do cabeçalho.");
    if (!raw.state) errors.push("Cidade deve terminar com / UF.");
    if (raw.cpf && cpfs.has(raw.cpf)) errors.push("CPF duplicado no arquivo.");
    if (raw.email && emails.has(raw.email))
      errors.push("E-mail duplicado no arquivo.");
    if (!errors.length) {
      cpfs.add(raw.cpf);
      if (raw.email) emails.add(raw.email);
    }
    rows.push({
      row: index + 2,
      data: parsed.success ? parsed.data : raw,
      errors,
    });
  }
  return { total: records.length, dismissed, rows };
}
