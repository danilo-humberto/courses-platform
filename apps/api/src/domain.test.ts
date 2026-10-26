import { describe, expect, it } from "vitest";
import { trainingStatus, csvCell, draftSchema } from "./domain.js";

describe("estado e exportação", () => {
  it("não confunde 100% dos slides com conclusão", () => {
    expect(trainingStatus(null, null)).toBe("not_started");
    expect(trainingStatus("2026-01-01", null)).toBe("in_progress");
    expect(trainingStatus("2026-01-01", "2026-01-02")).toBe("completed");
  });
  it("neutraliza fórmulas, aspas e quebras de linha no CSV", () => {
    expect(csvCell(" =SUM(A1)")).toBe('"\' =SUM(A1)"');
    expect(csvCell('Ana "Silva"\nRecife')).toBe('"Ana ""Silva""\nRecife"');
  });
});
describe("rascunho", () => {
  const base = {
    title: "Integração",
    description: "",
    quiz_enabled: true,
    pass_score: 70,
    max_attempts: 2,
  };
  it("rejeita questionário vazio e resposta fora das alternativas", () => {
    expect(draftSchema.safeParse({ ...base, questions: [] }).success).toBe(
      false,
    );
    expect(
      draftSchema.safeParse({
        ...base,
        questions: [{ prompt: "Qual?", options: ["A", "B"], correct_index: 2 }],
      }).success,
    ).toBe(false);
  });
  it("aceita curso sem questionário e remove campos desconhecidos", () => {
    expect(
      draftSchema.parse({
        ...base,
        quiz_enabled: false,
        questions: [],
        published_at: "forged",
      }),
    ).not.toHaveProperty("published_at");
  });
});
