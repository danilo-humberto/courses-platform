import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listen } = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("./app.js", () => ({ createApp: vi.fn(() => ({ listen })) }));

beforeEach(() => {
  vi.resetModules();
  listen.mockClear();
  vi.stubEnv("SUPABASE_URL", "https://synthetic.example.test");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable-key");
  vi.stubEnv("SUPABASE_SECRET_KEY", "synthetic-secret-key");
  vi.stubEnv("WEB_ORIGIN", "https://web.example.test");
  vi.stubEnv("PORT", "10000");
  vi.stubEnv("HOST", undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe("endereço de escuta da API", () => {
  it("mantém loopback como padrão local", async () => {
    await import("./index.js");
    expect(listen).toHaveBeenCalledWith(10000, "127.0.0.1", expect.any(Function));
  });

  it("usa HOST e PORT configurados no ambiente de hospedagem", async () => {
    vi.stubEnv("HOST", "0.0.0.0");
    await import("./index.js");
    expect(listen).toHaveBeenCalledWith(10000, "0.0.0.0", expect.any(Function));
  });
});
