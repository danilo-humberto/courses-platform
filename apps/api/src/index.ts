import { z } from "zod";
import { createApp } from "./app.js";
const parsed = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
    SUPABASE_SECRET_KEY: z.string().min(10),
    WEB_ORIGIN: z.url(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  })
  .safeParse(process.env);
if (!parsed.success) {
  console.error(
    "Configure .env conforme .env.example. Variáveis ausentes ou inválidas:",
    parsed.error.issues.map((i) => i.path.join(".")).join(", "),
  );
  process.exit(1);
}
const env = parsed.data;
createApp({
  url: env.SUPABASE_URL,
  publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
  secretKey: env.SUPABASE_SECRET_KEY,
  origin: env.WEB_ORIGIN,
}).listen(env.PORT, "127.0.0.1", () =>
  console.log(`API CIFRA em http://localhost:${env.PORT}`),
);
