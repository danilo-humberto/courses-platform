import { z } from "zod";
export function trainingStatus(
  started: string | null,
  completed: string | null,
) {
  return completed ? "completed" : started ? "in_progress" : "not_started";
}
export function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
const question = z
  .object({
    prompt: z.string().trim().min(1).max(2000),
    options: z.array(z.string().trim().min(1).max(500)).min(2).max(6),
    correct_index: z.number().int().min(0).max(5),
  })
  .refine((q) => q.correct_index < q.options.length);
export const draftSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    description: z.string().trim().max(5000).default(""),
    quiz_enabled: z.boolean(),
    pass_score: z.number().min(1).max(100),
    max_attempts: z.number().int().min(1).max(20),
    questions: z.array(question).max(50),
  })
  .refine((d) => !d.quiz_enabled || d.questions.length > 0);
