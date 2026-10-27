import { expect, it } from "vitest";
import { loginEmail } from "./login";
it("maps CPF without losing leading zero and preserves existing email login", () => {
  expect(loginEmail("01234567890")).toBe("01234567890@cifraengenharia.com.br");
  expect(loginEmail("ADMIN@example.test")).toBe("admin@example.test");
  expect(() => loginEmail("012.345.678-90")).toThrow(/sem pontuação/);
});
