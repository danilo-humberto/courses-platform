import { createClient } from "@supabase/supabase-js";
const apiBase = `${(import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "")}/api`;
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key && !key.startsWith("replace-"));
export const supabase = configured ? createClient(url, key) : null;
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token ?? ""}`,
  };
  if (body && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.error || "Não foi possível conectar. Tente novamente.",
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export async function exportCsv(query: string) {
  const session = await supabase?.auth.getSession();
  const response = await fetch(
    `${apiBase}/admin/reports?${query}${query ? "&" : ""}format=csv`,
    {
      headers: {
        Authorization: `Bearer ${session?.data.session?.access_token}`,
      },
    },
  );
  if (!response.ok) throw new Error("Não foi possível exportar o relatório.");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = "cifra-auditoria.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function apiBlob(path: string, method = "GET", body?: FormData) {
  const session = await supabase?.auth.getSession();
  const response = await fetch(`${apiBase}${path}`, {
    method,
    body,
    headers: {
      Authorization: `Bearer ${session?.data.session?.access_token ?? ""}`,
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.error || "Não foi possível carregar o PDF. Tente novamente.",
    );
  }
  return response.blob();
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
