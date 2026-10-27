import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApp, type Profile } from "./app.js";
const target = "20000000-0000-4000-8000-000000000001";
function fixture(role: Profile["role"], supreme = false) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const profile = {
    id: "10000000-0000-4000-8000-000000000001",
    name: "GTI",
    email: "gti@cifraengenharia.com.br",
    role,
    active: true,
    is_supreme: supreme,
  };
  const range = vi.fn().mockResolvedValue({
    data: [
      profile,
      { id: target, role: "admin" },
      { id: "learner", role: "manager" },
    ],
    error: null,
  });
  const query = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range,
  };
  const app = createApp(
    {
      url: "http://127.0.0.1:54321",
      publishableKey: "synthetic",
      secretKey: "synthetic",
      origin: "http://localhost:5173",
    },
    {
      authenticate: async () => ({
        profile,
        db: { rpc, from: () => query } as unknown as SupabaseClient,
      }),
      service: {} as SupabaseClient,
    },
  );
  return { app, rpc, range };
}
describe("admin promotion", () => {
  it.each([
    "/api/assignments",
    "/api/admin/reports",
    "/api/admin/reports?format=csv",
  ])("omits history whose profile is hidden by RLS in %s", async (path) => {
    const { app, range } = fixture("admin");
    range.mockResolvedValue({
      data: [
        {
          id: target,
          manager_id: target,
          manager: null,
          version: { title: "Private training", page_count: 1 },
          views: [],
          attempts: [],
          completion: null,
          started_at: null,
        },
      ],
      error: null,
    });
    const response = await request(app)
      .get(path)
      .auth("synthetic", { type: "bearer" });
    expect(response.status).toBe(200);
    expect(response.text).not.toContain(target);
    expect(response.text).not.toContain("Private training");
    if (!path.includes("csv")) expect(response.body).toEqual([]);
  });
  it.each(["manager", "admin"] as const)(
    "denies %s even with GTI name and email",
    async (role) => {
      const { app, rpc } = fixture(role);
      const response = await request(app)
        .post(`/api/admin/users/${target}/promote`)
        .auth("synthetic", { type: "bearer" });
      expect(response.status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("allows only supreme to promote through protected RPC", async () => {
    const { app, rpc } = fixture("admin", true);
    const response = await request(app)
      .post(`/api/admin/users/${target}/promote`)
      .auth("synthetic", { type: "bearer" });
    expect(response.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("supreme_promote_admin", { p_id: target });
  });
  it("hides administrative accounts from ordinary admin listings", async () => {
    const { app } = fixture("admin");
    const response = await request(app)
      .get("/api/admin/users")
      .auth("synthetic", { type: "bearer" });
    expect(response.body).toEqual([{ id: "learner", role: "manager" }]);
  });
});
