import { it, expect, vi } from "vitest";
import request from "supertest";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApp, type Profile } from "./app.js";
const id = "11111111-1111-4111-8111-111111111111";
const config = {
  hours: "4 horas",
  fields: [
    {
      key: "nome",
      x: 0.1,
      y: 0.5,
      width: 0.8,
      size: 24,
      color: "#152D40",
      align: "center",
    },
  ],
};
const profile: Profile = {
  id,
  name: "Sintético",
  email: "test@example.test",
  role: "manager",
  active: true,
};
it("usa modelo padrão sem upload e fixa as posições dos campos", async () => {
  const f = await fixture({ admin: true });
  const r = await request(f.app)
    .put(`/api/admin/versions/${id}/certificate`)
    .auth("token", { type: "bearer" })
    .field("enabled", "true")
    .field("config", JSON.stringify(config));
  expect(r.status).toBe(200);
  expect(r.body.fields.map((field: { key: string }) => field.key)).toEqual([
    "nome",
  ]);
  expect(r.body.fields[0].y).toBe(0.452);
  expect(f.upload).toHaveBeenCalledTimes(1);
});
it("gera prévia com modelo padrão sem receber PDF", async () => {
  const f = await fixture({ admin: true });
  const r = await request(f.app)
    .post("/api/admin/certificates/preview")
    .auth("token", { type: "bearer" })
    .field("config", JSON.stringify(config));
  expect(r.status).toBe(200);
  expect((await PDFDocument.load(r.body)).getPageCount()).toBe(1);
  const task = getDocument({ data: new Uint8Array(r.body) });
  const pdf = await task.promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  const text = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  expect(text).toContain("Maria Exemplo da Silva");
  expect(text).not.toContain("CPF:");
  expect(text).not.toContain("Conclusão:");
  expect(text).not.toContain("SEM VALIDADE");
  await task.destroy();
});
async function fixture(
  options: {
    admin?: boolean;
    missing?: boolean;
    published?: boolean;
    storageFailure?: boolean;
  } = {},
) {
  const pdf = await PDFDocument.create();
  pdf.addPage([842, 595]).drawText("CERTIFICADO");
  const source = await pdf.save();
  const files = new Map<string, Uint8Array>([
    ["templates/example.pdf", source],
  ]);
  const download = vi.fn(async (path: string) => ({
    data: files.has(path) ? new Blob([Buffer.from(files.get(path)!)]) : null,
    error: files.has(path) ? null : { message: "missing" },
  }));
  const upload = vi.fn(async (path: string, bytes: Uint8Array) => {
    if (options.storageFailure)
      return { data: null, error: { message: "failure" } };
    files.set(path, bytes);
    return { data: { path }, error: null };
  });
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: options.missing
            ? null
            : table === "certificates"
              ? {
                  id,
                  template: { ...config, path: "templates/example.pdf" },
                  values: { nome: "Nome preservado" },
                }
              : {
                  certificate: null,
                  published_at: options.published ? "2026-01-01" : null,
                },
          error: null,
        }),
      }),
    }),
  }));
  const service = {
    rpc,
    storage: { from: () => ({ download, upload, remove: vi.fn() }) },
  } as unknown as SupabaseClient;
  const app = createApp(
    {
      url: "http://127.0.0.1:54321",
      publishableKey: "synthetic",
      secretKey: "synthetic",
      origin: "http://localhost:5173",
    },
    {
      authenticate: async () => ({
        profile: { ...profile, role: options.admin ? "admin" : "manager" },
        db: { from } as unknown as SupabaseClient,
      }),
      service,
    },
  );
  return { app, files, download, upload, rpc, source };
}
it("recusa acesso inexistente ou negado pela RLS antes de consultar o Storage", async () => {
  const f = await fixture({ missing: true });
  expect(
    (
      await request(f.app)
        .get(`/api/certificates/${id}/pdf`)
        .auth("token", { type: "bearer" })
    ).status,
  ).toBe(404);
  expect(f.download).not.toHaveBeenCalled();
});
it("gera e preserva o mesmo arquivo nos downloads seguintes", async () => {
  const f = await fixture();
  const a = await request(f.app)
    .get(`/api/certificates/${id}/pdf`)
    .auth("token", { type: "bearer" });
  expect(a.status).toBe(200);
  expect(a.headers["content-type"]).toContain("application/pdf");
  const b = await request(f.app)
    .get(`/api/certificates/${id}/pdf`)
    .auth("token", { type: "bearer" });
  expect(b.body).toEqual(a.body);
  expect(f.upload).toHaveBeenCalledTimes(1);
});
it("não entrega um PDF que falhou ao persistir", async () => {
  const f = await fixture({ storageFailure: true });
  expect(
    (
      await request(f.app)
        .get(`/api/certificates/${id}/pdf`)
        .auth("token", { type: "bearer" })
    ).status,
  ).not.toBe(200);
});
it("nega configuração e prévia para participante", async () => {
  const f = await fixture();
  expect(
    (
      await request(f.app)
        .put(`/api/admin/versions/${id}/certificate`)
        .auth("token", { type: "bearer" })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(f.app)
        .post("/api/admin/certificates/preview")
        .auth("token", { type: "bearer" })
    ).status,
  ).toBe(403);
  expect(f.upload).not.toHaveBeenCalled();
});
it("não altera modelo publicado", async () => {
  const f = await fixture({ admin: true, published: true });
  expect(
    (
      await request(f.app)
        .put(`/api/admin/versions/${id}/certificate`)
        .auth("token", { type: "bearer" })
        .field("enabled", "false")
    ).status,
  ).toBe(400);
  expect(f.rpc).not.toHaveBeenCalled();
});
it("salva modelo validado com caminho gerado no servidor", async () => {
  const f = await fixture({ admin: true });
  const r = await request(f.app)
    .put(`/api/admin/versions/${id}/certificate`)
    .auth("token", { type: "bearer" })
    .field("enabled", "true")
    .field("config", JSON.stringify({ ...config, path: "forged.pdf" }))
    .attach("pdf", Buffer.from(f.source), "modelo.pdf");
  expect(r.status).toBe(200);
  expect(r.body.path).toMatch(new RegExp(`^templates/${id}/`));
  expect(f.rpc).toHaveBeenCalledWith("set_draft_certificate", {
    p_actor: id,
    p_version: id,
    p_config: r.body,
  });
});
it("prévia usa somente dados fictícios", async () => {
  const f = await fixture({ admin: true });
  const r = await request(f.app)
    .post("/api/admin/certificates/preview")
    .auth("token", { type: "bearer" })
    .field("config", JSON.stringify(config))
    .attach("pdf", Buffer.from(f.source), "modelo.pdf");
  expect(r.status).toBe(200);
  expect((await PDFDocument.load(r.body)).getPageCount()).toBe(1);
  expect(f.rpc).not.toHaveBeenCalled();
});
