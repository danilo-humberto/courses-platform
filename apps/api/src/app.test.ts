import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp, type Profile } from "./app.js";
import type { SupabaseClient } from "@supabase/supabase-js";
const user: Profile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Teste",
  email: "synthetic@example.test",
  role: "manager",
  active: true,
};
const config = {
  url: "http://127.0.0.1:54321",
  publishableKey: "synthetic",
  secretKey: "synthetic",
  origin: "http://localhost:5173",
};
function fixture(profile = user) {
  const rpc = vi.fn().mockResolvedValue({ data: user.id, error: null });
  const deleteUser = vi
    .fn()
    .mockResolvedValue({ data: { user: null }, error: null });
  const db = { rpc } as unknown as SupabaseClient;
  return {
    rpc,
    deleteUser,
    app: createApp(config, {
      authenticate: async () => ({ profile, db }),
      service: { auth: { admin: { deleteUser } } } as unknown as SupabaseClient,
    }),
  };
}
describe("fronteira da API", () => {
  it("limpa todo o relatório com confirmação explícita", async () => {
    const { app, rpc } = fixture({ ...user, role: "admin" });
    const response = await request(app)
      .delete("/api/admin/reports")
      .auth("token", { type: "bearer" })
      .send({ confirmation: "EXCLUIR TUDO" });
    expect(response.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("admin_clear_reports", {
      p_confirmation: "EXCLUIR TUDO",
    });
  });
  it.each([{}, { confirmation: "" }, { confirmation: true }])(
    "recusa limpeza sem confirmação válida: %j",
    async (body) => {
      const { app, rpc } = fixture({ ...user, role: "admin" });
      expect(
        (
          await request(app)
            .delete("/api/admin/reports")
            .auth("token", { type: "bearer" })
            .send(body)
        ).status,
      ).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("nega limpeza ao gerente", async () => {
    const { app, rpc } = fixture();
    expect(
      (
        await request(app)
          .delete("/api/admin/reports")
          .auth("token", { type: "bearer" })
          .send({ confirmation: "EXCLUIR TUDO" })
      ).status,
    ).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("informa migração pendente sem expor detalhes", async () => {
    const { app, rpc } = fixture({ ...user, role: "admin" });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "private details" },
    });
    const response = await request(app)
      .delete("/api/admin/reports")
      .auth("token", { type: "bearer" })
      .send({ confirmation: "EXCLUIR TUDO" });
    expect(response.status).toBe(503);
    expect(response.text).not.toContain("private details");
  });
  it("exclui curso pela operação transacional", async () => {
    const { app, rpc } = fixture({ ...user, role: "admin" });
    const response = await request(app)
      .delete(`/api/admin/courses/${user.id}`)
      .auth("token", { type: "bearer" });
    expect(response.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("admin_delete_course", {
      p_course: user.id,
      p_delete_assignments: false,
    });
  });
  it("encaminha consentimento explícito para excluir atribuições", async () => {
    const { app, rpc } = fixture({ ...user, role: "admin" });
    const response = await request(app)
      .delete(`/api/admin/courses/${user.id}`)
      .auth("token", { type: "bearer" })
      .send({ delete_assignments: true });
    expect(response.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("admin_delete_course", {
      p_course: user.id,
      p_delete_assignments: true,
    });
  });
  it.each(["true", 1, null])(
    "rejeita consentimento não booleano: %s",
    async (value) => {
      const { app, rpc } = fixture({ ...user, role: "admin" });
      const response = await request(app)
        .delete(`/api/admin/courses/${user.id}`)
        .auth("token", { type: "bearer" })
        .send({ delete_assignments: value });
      expect(response.status).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["P0001", "Curso possui atribuições. Use Arquivar.", 400],
    ["PGRST202", "internal details", 503],
  ])("trata falha na exclusão de curso %s", async (code, message, status) => {
    const { app, rpc } = fixture({ ...user, role: "admin" });
    rpc.mockResolvedValue({ data: null, error: { code, message } });
    const response = await request(app)
      .delete(`/api/admin/courses/${user.id}`)
      .auth("token", { type: "bearer" });
    expect(response.status).toBe(status);
    expect(response.body.error).toContain(
      code === "P0001" ? "Use Arquivar" : "atualização do banco",
    );
    expect(response.text).not.toContain("internal details");
  });
  it("nega exclusão de curso ao gerente e valida UUID", async () => {
    const denied = fixture();
    expect(
      (
        await request(denied.app)
          .delete(`/api/admin/courses/${user.id}`)
          .auth("token", { type: "bearer" })
      ).status,
    ).toBe(403);
    expect(denied.rpc).not.toHaveBeenCalled();
    const invalid = fixture({ ...user, role: "admin" });
    expect(
      (
        await request(invalid.app)
          .delete("/api/admin/courses/invalid")
          .auth("token", { type: "bearer" })
      ).status,
    ).toBe(400);
    expect(invalid.rpc).not.toHaveBeenCalled();
  });
  it("explica migração pendente na exclusão sem expor erro do provedor", async () => {
    const { app, rpc } = fixture({ ...user, role: "admin" });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "sensitive provider details" },
    });
    const response = await request(app)
      .delete(`/api/admin/users/${user.id}`)
      .auth("token", { type: "bearer" });
    expect(response.status).toBe(503);
    expect(response.body.error).toContain("atualização do banco de dados");
    expect(response.text).not.toContain("sensitive");
  });
  it("prepara exclusão e remove conta do Auth preservando o histórico", async () => {
    const { app, rpc, deleteUser } = fixture({ ...user, role: "admin" });
    const response = await request(app)
      .delete(`/api/admin/users/${user.id}`)
      .auth("token", { type: "bearer" });
    expect(response.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("admin_prepare_manager_deletion", {
      p_id: user.id,
    });
    expect(deleteUser).toHaveBeenCalledWith(user.id, false);
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0],
    );
  });
  it("não remove Auth quando preparação no banco falha", async () => {
    const { app, rpc, deleteUser } = fixture({ ...user, role: "admin" });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "denied" },
    });
    expect(
      (
        await request(app)
          .delete(`/api/admin/users/${user.id}`)
          .auth("token", { type: "bearer" })
      ).status,
    ).toBe(403);
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("explica falha parcial e permite repetir remoção do Auth", async () => {
    const { app, deleteUser } = fixture({ ...user, role: "admin" });
    deleteUser.mockResolvedValueOnce({
      data: null,
      error: {
        code: "unexpected_failure",
        message: "sensitive provider details",
      },
    });
    const response = await request(app)
      .delete(`/api/admin/users/${user.id}`)
      .auth("token", { type: "bearer" });
    expect(response.status).toBe(502);
    expect(response.body.error).toContain("Supabase Auth");
    expect(response.text).not.toContain("sensitive");
    expect(
      (
        await request(app)
          .delete(`/api/admin/users/${user.id}`)
          .auth("token", { type: "bearer" })
      ).status,
    ).toBe(204);
  });
  it("exclusão já concluída é idempotente", async () => {
    const { app, rpc, deleteUser } = fixture({ ...user, role: "admin" });
    rpc.mockResolvedValue({ data: null, error: null });
    expect(
      (
        await request(app)
          .delete(`/api/admin/users/${user.id}`)
          .auth("token", { type: "bearer" })
      ).status,
    ).toBe(204);
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("nega exclusão ao gerente e rejeita identificador inválido", async () => {
    const denied = fixture();
    expect(
      (
        await request(denied.app)
          .delete(`/api/admin/users/${user.id}`)
          .auth("token", { type: "bearer" })
      ).status,
    ).toBe(403);
    expect(denied.rpc).not.toHaveBeenCalled();
    const invalid = fixture({ ...user, role: "admin" });
    expect(
      (
        await request(invalid.app)
          .delete("/api/admin/users/invalid")
          .auth("token", { type: "bearer" })
      ).status,
    ).toBe(400);
    expect(invalid.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["weak_password", 400, "requisitos de segurança"],
    ["email_exists", 409, "já está cadastrado"],
    ["unexpected_failure", 502, "serviço de autenticação"],
  ])(
    "explica falha de cadastro %s sem expor detalhes internos",
    async (code, status, message) => {
      const app = createApp(config, {
        authenticate: async () => ({
          profile: { ...user, role: "admin" },
          db: {} as SupabaseClient,
        }),
        service: {
          auth: {
            admin: {
              createUser: vi.fn().mockResolvedValue({
                data: { user: null },
                error: { code, message: "sensitive internal text" },
              }),
            },
          },
        } as unknown as SupabaseClient,
      });
      const response = await request(app)
        .post("/api/admin/users")
        .auth("token", { type: "bearer" })
        .send({
          name: "Teste",
          email: "new@example.test",
          password: "synthetic-password-123",
        });
      expect(response.status).toBe(status);
      expect(response.body.error).toContain(message);
      expect(response.text).not.toContain("sensitive");
    },
  );
  it("exige autenticação", async () =>
    expect((await request(fixture().app).get("/api/me")).status).toBe(401));
  it("bloqueia usuário desativado com sessão existente", async () =>
    expect(
      (
        await request(fixture({ ...user, active: false }).app)
          .get("/api/me")
          .auth("token", { type: "bearer" })
      ).status,
    ).toBe(403));
  it("nega todas as rotas administrativas ao gerente", async () => {
    for (const path of ["/users", "/reports", "/audit"])
      expect(
        (
          await request(fixture().app)
            .get("/api/admin" + path)
            .auth("token", { type: "bearer" })
        ).status,
      ).toBe(403);
  });
  it("rejeita página inválida antes de escrever", async () => {
    const { app, rpc } = fixture();
    const response = await request(app)
      .post(`/api/assignments/${user.id}/views`)
      .auth("token", { type: "bearer" })
      .send({ page: 0 });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("preserva negação de acesso do banco para atribuição de outro usuário", async () => {
    const { app, rpc } = fixture();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "sensitive internal text" },
    });
    const response = await request(app)
      .post(`/api/assignments/${user.id}/complete`)
      .auth("token", { type: "bearer" });
    expect(response.status).toBe(403);
    expect(response.text).not.toContain("sensitive");
  });
});
