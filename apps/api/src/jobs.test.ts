import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApp, type Profile } from "./app.js";

const jobId = "70000000-0000-4000-8000-000000000001";
const users = [
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
];
function fixture(role: Profile["role"] = "admin") {
  const rpc = vi.fn().mockResolvedValue({ data: jobId, error: null });
  const range = vi.fn().mockResolvedValue({
    data: [{ id: jobId, name: "Analista", description: "" }],
    error: null,
  });
  const query = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range,
  };
  const from = vi.fn().mockReturnValue(query);
  const app = createApp(
    {
      url: "http://127.0.0.1:54321",
      publishableKey: "synthetic",
      secretKey: "synthetic",
      origin: "http://localhost:5173",
    },
    {
      authenticate: async () => ({
        profile: {
          id: users[0],
          name: "Teste",
          email: "test@example.test",
          role,
          active: true,
        },
        db: { rpc, from } as unknown as SupabaseClient,
      }),
      service: {} as SupabaseClient,
    },
  );
  return { app, rpc, from, range };
}
describe("cargos", () => {
  it("mantém a listagem de usuários antes da migration de cargos", async () => {
    const { app, range, from } = fixture();
    const profiles = [
      {
        id: users[0],
        name: "Ana",
        email: "ana@example.test",
        role: "manager",
        active: true,
      },
    ];
    range.mockResolvedValueOnce({ data: profiles, error: null });
    const response = await request(app)
      .get("/api/admin/users")
      .auth("synthetic", { type: "bearer" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(profiles);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("profiles");
  });
  it("inclui o nome do cargo sem alterar o papel do usuário", async () => {
    const { app, range } = fixture();
    range.mockResolvedValueOnce({
      data: [{ id: users[0], name: "Ana", role: "manager", job_id: jobId }],
      error: null,
    });
    const response = await request(app)
      .get("/api/admin/users")
      .auth("synthetic", { type: "bearer" });
    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      role: "manager",
      job_id: jobId,
      job: { id: jobId, name: "Analista" },
    });
  });
  it("lista cargos", async () => {
    const { app, from } = fixture();
    const response = await request(app)
      .get("/api/admin/jobs")
      .auth("synthetic", { type: "bearer" });
    expect(response.status).toBe(200);
    expect(response.body[0].name).toBe("Analista");
    expect(from).toHaveBeenCalledWith("job_positions");
  });
  it("cria cargo com nome normalizado", async () => {
    const { app, rpc } = fixture();
    const response = await request(app)
      .post("/api/admin/jobs")
      .auth("synthetic", { type: "bearer" })
      .send({ name: " Analista ", description: "Equipe" });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: jobId });
    expect(rpc).toHaveBeenCalledWith("admin_save_job", {
      p_id: null,
      p_name: "Analista",
      p_description: "Equipe",
    });
  });
  it("edita e exclui cargo", async () => {
    const { app, rpc } = fixture();
    expect(
      (
        await request(app)
          .patch(`/api/admin/jobs/${jobId}`)
          .auth("synthetic", { type: "bearer" })
          .send({ name: "Engenheiro", description: "Obras" })
      ).status,
    ).toBe(204);
    expect(rpc).toHaveBeenCalledWith("admin_save_job", {
      p_id: jobId,
      p_name: "Engenheiro",
      p_description: "Obras",
    });
    expect(
      (
        await request(app)
          .delete(`/api/admin/jobs/${jobId}`)
          .auth("synthetic", { type: "bearer" })
      ).status,
    ).toBe(204);
    expect(rpc).toHaveBeenCalledWith("admin_delete_job", { p_id: jobId });
  });
  it("atribui vários usuários em uma única operação", async () => {
    const { app, rpc } = fixture();
    expect(
      (
        await request(app)
          .post(`/api/admin/jobs/${jobId}/assign`)
          .auth("synthetic", { type: "bearer" })
          .send({ users })
      ).status,
    ).toBe(204);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("admin_assign_job", {
      p_job: jobId,
      p_users: users,
    });
  });
  it.each(
    [[], ["invalid"], Array(201).fill(users[0]), [users[0], users[0]]].map(
      (selected) => ({ selected }),
    ),
  )("recusa lote inválido: $selected", async ({ selected }) => {
    const { app, rpc } = fixture();
    expect(
      (
        await request(app)
          .post(`/api/admin/jobs/${jobId}/assign`)
          .auth("synthetic", { type: "bearer" })
          .send({ users: selected })
      ).status,
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["", "  ", "a".repeat(121)])("recusa nome inválido", async (name) => {
    const { app, rpc } = fixture();
    expect(
      (
        await request(app)
          .post("/api/admin/jobs")
          .auth("synthetic", { type: "bearer" })
          .send({ name })
      ).status,
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("recusa identificador inválido", async () => {
    const { app, rpc } = fixture();
    expect(
      (
        await request(app)
          .delete("/api/admin/jobs/invalid")
          .auth("synthetic", { type: "bearer" })
      ).status,
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("propaga falha de atribuição sem indicar sucesso", async () => {
    const { app, rpc } = fixture();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Usuário inativo ou inválido." },
    });
    const response = await request(app)
      .post(`/api/admin/jobs/${jobId}/assign`)
      .auth("synthetic", { type: "bearer" })
      .send({ users });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Usuário inativo ou inválido.");
  });
  it("restringe todas as operações ao administrador", async () => {
    const { app, rpc, from } = fixture("manager");
    for (const [method, path] of [
      ["get", "/jobs"],
      ["post", "/jobs"],
      ["patch", `/jobs/${jobId}`],
      ["delete", `/jobs/${jobId}`],
      ["post", `/jobs/${jobId}/assign`],
    ] as const) {
      const operation = request(app)[method](`/api/admin${path}`);
      expect(
        (
          await operation
            .auth("synthetic", { type: "bearer" })
            .send({ name: "Analista", users })
        ).status,
      ).toBe(403);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
