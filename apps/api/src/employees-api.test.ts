import { it, expect, vi } from "vitest";
import request from "supertest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApp } from "./app.js";
const id = "20000000-0000-4000-8000-000000000001";
function fixture(role: "manager" | "admin" = "admin") {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: [{ status: "created", id }], error: null });
  const createUser = vi
    .fn()
    .mockResolvedValue({ data: { user: { id } }, error: null });
  const updateUserById = vi
    .fn()
    .mockResolvedValue({ data: { user: { id } }, error: null });
  const app = createApp(
    {
      url: "http://127.0.0.1:54321",
      publishableKey: "synthetic",
      secretKey: "synthetic",
      origin: "http://localhost",
    },
    {
      authenticate: async () => ({
        profile: { id, name: "Synthetic", email: "", role, active: true },
        db: { rpc } as unknown as SupabaseClient,
      }),
      service: {
        auth: { admin: { createUser, updateUserById } },
      } as unknown as SupabaseClient,
    },
  );
  return { app, rpc, createUser, updateUserById };
}
it("resets a provisioned CPF identity with explicit confirmation and one-use operation", async () => {
  const { app, rpc, createUser, updateUserById } = fixture();
  rpc.mockResolvedValue({
    data: {
      id,
      cpf: "01234567890",
      auth_user_id: id,
      operation: "synthetic-operation",
    },
    error: null,
  });
  const response = await request(app)
    .post(`/api/admin/users/${id}/password`)
    .auth("synthetic", { type: "bearer" })
    .send({ reset: true });
  expect(response.status).toBe(201);
  expect(rpc).toHaveBeenCalledWith("admin_employee_password_target", {
    p_id: id,
    p_reset: true,
  });
  expect(createUser).not.toHaveBeenCalled();
  expect(updateUserById).toHaveBeenCalledWith(id, {
    password: response.body.password,
    app_metadata: { employee_password_operation: "synthetic-operation" },
  });
});
it("rejects oversized CSV and multiple files with the correct upload guidance", async () => {
  const { app, rpc } = fixture();
  const large = await request(app)
    .post("/api/admin/users/import/preview")
    .auth("synthetic", { type: "bearer" })
    .attach("file", Buffer.alloc(8 * 1024 * 1024 + 1), "large.csv");
  expect(large.status).toBe(400);
  expect(large.body.error).toContain("CSV de até 8 MB");
  const multiple = await request(app)
    .post("/api/admin/users/import/preview")
    .auth("synthetic", { type: "bearer" })
    .attach("file", Buffer.from("a"), "a.csv")
    .attach("file", Buffer.from("b"), "b.csv");
  expect(multiple.status).toBe(400);
  expect(multiple.body.error).toContain("CSV de até 8 MB");
  expect(rpc).not.toHaveBeenCalled();
});
it("creates a pending employee without calling Auth or honoring supplied privilege fields", async () => {
  const { app, rpc, createUser } = fixture();
  const response = await request(app)
    .post("/api/admin/users")
    .auth("synthetic", { type: "bearer" })
    .send({
      name: "Ana",
      cpf: "01234567890",
      email: "",
      role: "admin",
      is_supreme: true,
      password: "ignored",
    });
  expect(response.status).toBe(201);
  expect(createUser).not.toHaveBeenCalled();
  expect(rpc.mock.calls[0][1].p_rows[0].data).toEqual({
    name: "Ana",
    cpf: "01234567890",
    email: "",
    state: "",
    cost_center: "",
    job_name: "",
  });
});
it("previews without writes and re-cleans on confirmation, excluding dismissed and malformed records", async () => {
  const { app, rpc } = fixture();
  const file = Buffer.from(
    "Nome;e-mail;Cidade;CPF;Centro de custo;Cargo atual;Data de desligamento\nAna;;Recife / PE;01234567890;TI;Dev;\nBia;;Recife / PE;12345678901;TI;Dev;01/01/2026\nBad;;Recife / PE;123;TI;Dev;",
  );
  const preview = await request(app)
    .post("/api/admin/users/import/preview")
    .auth("synthetic", { type: "bearer" })
    .attach("file", file, "base.csv");
  expect(preview.status).toBe(200);
  expect(preview.body.dismissed).toBe(1);
  expect(rpc).not.toHaveBeenCalled();
  const blocked = await request(app)
    .post("/api/admin/users/import/confirm")
    .auth("synthetic", { type: "bearer" })
    .attach("file", file, "base.csv");
  expect(blocked.status).toBe(400);
  expect(blocked.body.error).toMatch(/pendências/);
  expect(rpc).not.toHaveBeenCalled();
  const confirm = await request(app)
    .post("/api/admin/users/import/confirm")
    .auth("synthetic", { type: "bearer" })
    .field("ignorePending", "true")
    .attach("file", file, "base.csv");
  expect(confirm.status).toBe(200);
  expect(rpc.mock.calls[0][1].p_rows).toHaveLength(1);
});
it("generates a cryptographic password for the protected CPF identity with no-store response", async () => {
  const { app, rpc, createUser } = fixture();
  rpc.mockResolvedValue({ data: { id, cpf: "01234567890" }, error: null });
  const response = await request(app)
    .post(`/api/admin/users/${id}/password`)
    .auth("synthetic", { type: "bearer" })
    .send({ email: "attacker@example.test" });
  expect(response.status).toBe(201);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.body.password.length).toBeGreaterThanOrEqual(24);
  expect(createUser).toHaveBeenCalledWith({
    id,
    email: "01234567890@cifraengenharia.com.br",
    password: response.body.password,
    email_confirm: true,
  });
});
it.each([
  "/api/admin/users",
  "/api/admin/users/import/preview",
  `/api/admin/users/${id}/password`,
])("denies employee access to %s", async (path) => {
  const { app, rpc, createUser } = fixture("manager");
  expect(
    (
      await request(app)
        .post(path)
        .auth("synthetic", { type: "bearer" })
        .send({})
    ).status,
  ).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
  expect(createUser).not.toHaveBeenCalled();
});
it("does not call Auth when the database rejects an already provisioned or forbidden account", async () => {
  const { app, rpc, createUser } = fixture();
  rpc.mockResolvedValue({
    data: null,
    error: { code: "P0001", message: "A senha inicial já foi gerada" },
  });
  expect(
    (
      await request(app)
        .post(`/api/admin/users/${id}/password`)
        .auth("synthetic", { type: "bearer" })
    ).status,
  ).toBe(400);
  expect(createUser).not.toHaveBeenCalled();
});
