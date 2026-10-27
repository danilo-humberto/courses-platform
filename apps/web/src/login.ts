export function loginEmail(identifier: string): string {
  const value = identifier.trim();
  if (/^\d{11}$/.test(value)) return `${value}@cifraengenharia.com.br`;
  if (value.includes("@")) return value.toLowerCase();
  throw new Error("Informe o CPF com 11 dígitos, sem pontuação.");
}
