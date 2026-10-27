import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "synthetic-token" } },
      })),
    },
  })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("destino das chamadas da API", () => {
  it.each([
    [undefined, "/api"],
    ["", "/api"],
    ["https://api.example.test", "https://api.example.test/api"],
    ["https://api.example.test/", "https://api.example.test/api"],
  ])("usa a origem %s em JSON, PDF e CSV", async (origin, base) => {
    vi.resetModules();
    vi.stubEnv("VITE_API_URL", origin);
    vi.stubEnv("VITE_SUPABASE_URL", "https://synthetic.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "synthetic-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { api, apiBlob, exportCsv } = await import("./lib");

    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}'));
    await expect(api("/courses")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${base}/courses`,
      expect.objectContaining({
        headers: { Authorization: "Bearer synthetic-token" },
      }),
    );

    fetchMock.mockResolvedValueOnce(new Response("synthetic-pdf"));
    const pdf = await apiBlob("/courses/1/pdf");
    expect(await pdf.text()).toBe("synthetic-pdf");
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${base}/courses/1/pdf`,
      expect.any(Object),
    );

    // Interrompe antes do download no DOM; nenhuma chamada de rede é feita.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(exportCsv("course=1")).rejects.toThrow(
      "Não foi possível exportar o relatório.",
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${base}/admin/reports?course=1&format=csv`,
      expect.any(Object),
    );
  });
});
