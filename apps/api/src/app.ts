import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { PDFDocument } from "pdf-lib";
import { z, ZodError } from "zod";
import { randomUUID, randomBytes } from "node:crypto";
import { cleanEmployees, employeeSchema } from "./employees.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { csvCell, draftSchema, trainingStatus } from "./domain.js";

export type Config = {
  url: string;
  publishableKey: string;
  secretKey: string;
  origin: string;
};
export type Profile = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager";
  is_supreme?: boolean;
  active: boolean;
  job_id?: string | null;
};
type Context = { db: SupabaseClient; profile: Profile };
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const uuid = z.string().uuid();
const id = (req: Request) => uuid.parse(req.params.id);
// Preserve deployed database contracts while presenting the current terminology.
const legacyUserMessages = new Map([
  ["Gerente não encontrado", "Usuário não encontrado"],
  ["Gerente não encontrado ou excluído", "Usuário não encontrado ou excluído"],
  ["Gerente inativo ou inválido", "Usuário inativo ou inválido"],
  ["Selecione de 1 a 200 gerentes", "Selecione de 1 a 200 usuários"],
]);
const checked = <T>(result: {
  data: T;
  error: { message: string; code?: string } | null;
}): T => {
  if (result.error) {
    const denied = result.error.code === "42501";
    throw new HttpError(
      denied ? 403 : 400,
      denied
        ? "Acesso negado."
        : result.error.code === "P0001"
          ? (legacyUserMessages.get(result.error.message) ??
            result.error.message)
          : "Não foi possível concluir a operação. Confira os dados.",
    );
  }
  return result.data;
};
const context = (res: Response) => res.locals.ctx as Context;
const admin = (_req: Request, res: Response, next: NextFunction) => {
  if (context(res).profile.role !== "admin")
    throw new HttpError(403, "Acesso restrito ao administrador.");
  next();
};

export function createApp(
  config: Config,
  deps?: {
    authenticate: (token: string) => Promise<Context>;
    service?: SupabaseClient;
  },
) {
  const app = express();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const service =
    deps?.service ?? createClient(config.url, config.secretKey, options);
  app.disable("x-powered-by");
  app.use(
    helmet(),
    cors({ origin: config.origin }),
    express.json({ limit: "256kb" }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 240,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api", async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw new HttpError(401, "Entre para continuar.");
    let ctx: Context;
    if (deps?.authenticate) ctx = await deps.authenticate(token);
    else {
      const db = createClient(config.url, config.publishableKey, {
        ...options,
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data, error } = await db.auth.getUser(token);
      if (error || !data.user)
        throw new HttpError(401, "Sessão inválida. Entre novamente.");
      const profile = checked(
        await db
          .from("profiles")
          .select("*")
          .eq("id", data.user.id)
          .maybeSingle(),
      ) as Profile | null;
      if (!profile)
        throw new HttpError(
          403,
          "Seu acesso está desativado. Procure o administrador.",
        );
      ctx = { db, profile };
    }
    if (!ctx.profile.active)
      throw new HttpError(
        403,
        "Seu acesso está desativado. Procure o administrador.",
      );
    res.locals.ctx = ctx;
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/me", (_req, res) => res.json(context(res).profile));
  app.get("/api/courses", async (_req, res) => {
    const { db } = context(res);
    res.json(
      await collectPages((offset) =>
        db
          .from("courses")
          .select("*,versions:course_versions(*)")
          .order("created_at", { ascending: false })
          .order("id")
          .range(offset, offset + 499),
      ),
    );
  });
  app.get("/api/assignments", async (_req, res) => {
    res.json(await assignments(context(res).db));
  });
  app.get("/api/assignments/:id", async (req, res) => {
    const { db } = context(res);
    const a = checked(
      await db
        .from("assignments")
        .select(
          "*,version:course_versions(*),views:slide_views(*),attempts:quiz_attempts(*),completion:completions(*)",
        )
        .eq("id", id(req))
        .maybeSingle(),
    );
    if (!a) throw new HttpError(404, "Treinamento não encontrado.");
    const questions = checked(
      await db
        .from("questions")
        .select("id,prompt,options,position")
        .eq("version_id", a.version_id)
        .order("position"),
    );
    res.json({ ...a, questions });
  });
  app.get("/api/assignments/:id/pdf", async (req, res) => {
    const { db } = context(res);
    const a = checked(
      await db
        .from("assignments")
        .select("version_id")
        .eq("id", id(req))
        .maybeSingle(),
    );
    if (!a) throw new HttpError(404, "Treinamento não encontrado.");
    const v = checked(
      await db
        .from("course_versions")
        .select("pdf_path")
        .eq("id", a.version_id)
        .single(),
    );
    if (!v?.pdf_path) throw new HttpError(404, "Apresentação não encontrada.");
    const link = checked(
      await db.storage.from("training-pdfs").createSignedUrl(v.pdf_path, 60),
    );
    if (!link) throw new HttpError(404, "Apresentação não encontrada.");
    res.json({ url: link.signedUrl });
  });
  app.post("/api/assignments/:id/start", async (req, res) => {
    checked(
      await context(res).db.rpc("training_start", { p_assignment: id(req) }),
    );
    res.sendStatus(204);
  });
  app.post("/api/assignments/:id/views", async (req, res) => {
    const { page } = z
      .object({ page: z.number().int().min(1).max(500) })
      .parse(req.body);
    checked(
      await context(res).db.rpc("training_view", {
        p_assignment: id(req),
        p_page: page,
      }),
    );
    res.sendStatus(204);
  });
  app.post("/api/assignments/:id/complete", async (req, res) => {
    checked(
      await context(res).db.rpc("training_complete", { p_assignment: id(req) }),
    );
    res.sendStatus(204);
  });
  app.post("/api/assignments/:id/attempts", async (req, res) => {
    const body = z
      .object({
        request_id: uuid,
        answers: z.record(uuid, z.number().int().min(0).max(5)),
      })
      .parse(req.body);
    res.json(
      checked(
        await context(res).db.rpc("training_submit", {
          p_assignment: id(req),
          p_request: body.request_id,
          p_answers: body.answers,
        }),
      ),
    );
  });
  app.use("/api/admin", admin);
  const jobSchema = z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(""),
  });
  app.get("/api/admin/jobs", async (_req, res) => {
    res.json(
      await collectPages((offset) =>
        context(res)
          .db.from("job_positions")
          .select("*")
          .order("name")
          .order("id")
          .range(offset, offset + 499),
      ),
    );
  });
  app.post("/api/admin/jobs", async (req, res) => {
    const body = jobSchema.parse(req.body);
    const jobId = checked(
      await context(res).db.rpc("admin_save_job", {
        p_id: null,
        p_name: body.name,
        p_description: body.description,
      }),
    );
    res.status(201).json({ id: jobId });
  });
  app.patch("/api/admin/jobs/:id", async (req, res) => {
    const body = jobSchema.parse(req.body);
    checked(
      await context(res).db.rpc("admin_save_job", {
        p_id: id(req),
        p_name: body.name,
        p_description: body.description,
      }),
    );
    res.sendStatus(204);
  });
  app.delete("/api/admin/jobs/:id", async (req, res) => {
    checked(await context(res).db.rpc("admin_delete_job", { p_id: id(req) }));
    res.sendStatus(204);
  });
  app.post("/api/admin/jobs/:id/assign", async (req, res) => {
    const body = z
      .object({
        users: z
          .array(uuid)
          .min(1)
          .max(200)
          .refine((users) => new Set(users).size === users.length),
      })
      .parse(req.body);
    checked(
      await context(res).db.rpc("admin_assign_job", {
        p_job: id(req),
        p_users: body.users,
      }),
    );
    res.sendStatus(204);
  });
  app.get("/api/admin/users", async (_req, res) => {
    const profiles = await collectPages<Profile>((offset) =>
      context(res)
        .db.from("profiles")
        .select("*")
        .order("name")
        .order("id")
        .range(offset, offset + 499),
    );
    const users = context(res).profile.is_supreme
      ? profiles
      : profiles.filter((user) => user.role === "manager");
    // Existing user management remains available before the jobs migration is applied.
    if (!users.some((user) => user.job_id)) {
      res.json(users);
      return;
    }
    const jobs = await collectPages<{ id: string; name: string }>((offset) =>
      context(res)
        .db.from("job_positions")
        .select("id,name")
        .order("id")
        .range(offset, offset + 499),
    );
    const byId = new Map(jobs.map((job) => [job.id, job]));
    res.json(
      users.map((user) => ({
        ...user,
        job: user.job_id ? (byId.get(user.job_id) ?? null) : null,
      })),
    );
  });
  app.post("/api/admin/users/:id/promote", async (req, res) => {
    if (!context(res).profile.is_supreme)
      throw new HttpError(
        403,
        "Somente a conta suprema pode promover administradores.",
      );
    checked(
      await context(res).db.rpc("supreme_promote_admin", { p_id: id(req) }),
    );
    res.sendStatus(204);
  });
  app.post("/api/admin/users", async (req, res) => {
    const body = employeeSchema.parse(req.body);
    const results = checked(
      await context(res).db.rpc("admin_create_employees", {
        p_rows: [{ row: 1, data: body }],
      }),
    ) as { status: string; id?: string }[];
    if (results[0]?.status === "duplicate")
      throw new HttpError(409, "CPF ou e-mail já cadastrado.");
    res.status(201).json({ id: results[0].id });
  });
  const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1, fieldSize: 16 },
  }).single("file");
  app.post("/api/admin/users/import/:mode", csvUpload, async (req, res) => {
    if (!["preview", "confirm"].includes(String(req.params.mode)))
      throw new HttpError(404, "Operação inválida.");
    if (!req.file) throw new HttpError(400, "Selecione um arquivo CSV.");
    let cleaned;
    try {
      cleaned = cleanEmployees(req.file.buffer);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    if (req.params.mode === "preview") {
      res.json(cleaned);
      return;
    }
    const valid = cleaned.rows.filter((row) => !row.errors.length);
    if (
      valid.length < cleaned.rows.length &&
      req.body?.ignorePending !== "true"
    )
      throw new HttpError(
        400,
        "Resolva ou ignore explicitamente as pendências antes de cadastrar.",
      );
    const results = valid.length
      ? checked(
          await context(res).db.rpc("admin_create_employees", {
            p_rows: valid.map(({ row, data }) => ({ row, data })),
          }),
        )
      : [];
    res.json({ ...cleaned, results });
  });
  app.post("/api/admin/users/:id/password", async (req, res) => {
    const body = z
      .object({ reset: z.boolean().default(false) })
      .parse(req.body ?? {});
    const target = checked(
      await context(res).db.rpc("admin_employee_password_target", {
        p_id: id(req),
        p_reset: body.reset,
      }),
    ) as {
      id: string;
      cpf: string;
      auth_user_id?: string | null;
      operation?: string;
    };
    // A reset requires explicit consent and a single-use database authorization.
    const password = `Aa1!${randomBytes(18).toString("base64url")}`;
    const { data, error } = target.auth_user_id
      ? await service.auth.admin.updateUserById(target.auth_user_id, {
          password,
          app_metadata: { employee_password_operation: target.operation },
        })
      : await service.auth.admin.createUser({
          id: target.id,
          email: `${target.cpf}@cifraengenharia.com.br`,
          password,
          email_confirm: true,
        });
    if (error || !data.user) {
      if (
        error?.code === "email_exists" ||
        error?.code === "user_already_exists"
      )
        throw new HttpError(
          409,
          "O acesso deste CPF já está cadastrado. Atualize a lista de usuários.",
        );
      if (error?.code === "weak_password")
        throw new HttpError(
          400,
          "A senha não atende aos requisitos de segurança do Supabase. Use uma senha longa e confira a política de senha configurada no projeto.",
        );
      if (error?.code === "email_address_invalid")
        throw new HttpError(
          400,
          "O serviço de autenticação recusou este e-mail. Confira o endereço informado.",
        );
      if (error?.code === "over_request_rate_limit")
        throw new HttpError(
          429,
          "Muitas tentativas de cadastro. Aguarde um pouco e tente novamente.",
        );
      throw new HttpError(
        502,
        "O serviço de autenticação não conseguiu criar o usuário. Verifique a configuração e os registros do Auth no Supabase.",
      );
    }
    res.status(201).json({ password });
  });
  app.delete("/api/admin/users/:id", async (req, res) => {
    const result = await context(res).db.rpc("admin_prepare_manager_deletion", {
      p_id: id(req),
    });
    if (result.error?.code === "PGRST202")
      throw new HttpError(
        503,
        "A exclusão de usuários no Auth depende de uma atualização do banco de dados. Solicite a aplicação da migração de remoção da conta de login.",
      );
    const authId = checked(result) as string | null;
    if (authId) {
      // Disable access first; failures leave a retryable pending deletion, never reactivate it.
      const { error } = await service.auth.admin.deleteUser(authId, false);
      if (error && error.code !== "user_not_found")
        throw new HttpError(
          502,
          "O acesso foi desativado, mas não foi possível remover a conta do Supabase Auth. O e-mail pode continuar reservado. Tente excluir novamente.",
        );
    }
    res.sendStatus(204);
  });
  app.patch("/api/admin/users/:id", async (req, res) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(120), active: z.boolean() })
      .parse(req.body);
    checked(
      await context(res).db.rpc("admin_save_profile", {
        p_id: id(req),
        p_name: body.name,
        p_active: body.active,
      }),
    );
    res.sendStatus(204);
  });
  app.post("/api/admin/courses", async (req, res) => {
    const data = draftSchema.parse(req.body);
    res.status(201).json(
      checked(
        await context(res).db.rpc("admin_save_draft", {
          p_course_id: null,
          p_data: data,
        }),
      ),
    );
  });
  app.put("/api/admin/courses/:id/draft", async (req, res) => {
    const data = draftSchema.parse(req.body);
    res.json(
      checked(
        await context(res).db.rpc("admin_save_draft", {
          p_course_id: id(req),
          p_data: data,
        }),
      ),
    );
  });
  app.get("/api/admin/versions/:id/questions", async (req, res) => {
    res.json(
      checked(
        await context(res).db.rpc("admin_questions", { p_version: id(req) }),
      ),
    );
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  });
  app.post(
    "/api/admin/versions/:id/pdf",
    upload.single("pdf"),
    async (req, res) => {
      const vid = id(req);
      const { db, profile } = context(res);
      const v = checked(
        await db
          .from("course_versions")
          .select("published_at")
          .eq("id", vid)
          .maybeSingle(),
      );
      if (!v || v.published_at)
        throw new HttpError(400, "Envie o PDF para um rascunho.");
      if (!req.file || req.file.buffer.subarray(0, 5).toString() !== "%PDF-")
        throw new HttpError(400, "Selecione um PDF válido de até 20 MB.");
      let count: number;
      try {
        count = (
          await PDFDocument.load(req.file.buffer, { updateMetadata: false })
        ).getPageCount();
      } catch {
        throw new HttpError(400, "PDF inválido ou protegido por senha.");
      }
      if (count < 1 || count > 500)
        throw new HttpError(400, "O PDF deve ter entre 1 e 500 páginas.");
      const path = `${vid}/${randomUUID()}.pdf`;
      checked(
        await service.storage
          .from("training-pdfs")
          .upload(path, req.file.buffer, {
            contentType: "application/pdf",
            upsert: false,
          }),
      );
      const result = await service.rpc("set_draft_pdf", {
        p_actor: profile.id,
        p_version: vid,
        p_path: path,
        p_pages: count,
      });
      if (result.error) {
        await service.storage.from("training-pdfs").remove([path]); // Only the new unreferenced upload.
        checked(result);
      }
      res.json({ page_count: count });
    },
  );
  app.post("/api/admin/versions/:id/publish", async (req, res) => {
    checked(await context(res).db.rpc("admin_publish", { p_version: id(req) }));
    res.sendStatus(204);
  });
  app.delete("/api/admin/courses/:id", async (req, res) => {
    const body = z
      .object({ delete_assignments: z.boolean().default(false) })
      .parse(req.body ?? {});
    const result = await context(res).db.rpc("admin_delete_course", {
      p_course: id(req),
      p_delete_assignments: body.delete_assignments,
    });
    if (result.error?.code === "PGRST202")
      throw new HttpError(
        503,
        "A exclusão de cursos depende de uma atualização do banco de dados. Solicite a aplicação da migração de exclusão de cursos.",
      );
    checked(result);
    res.sendStatus(204);
  });
  app.post("/api/admin/courses/:id/archive", async (req, res) => {
    checked(await context(res).db.rpc("admin_archive", { p_course: id(req) }));
    res.sendStatus(204);
  });
  app.post("/api/admin/versions/:id/assign", async (req, res) => {
    const { managers } = z
      .object({ managers: z.array(uuid).min(1).max(200) })
      .parse(req.body);
    checked(
      await context(res).db.rpc("admin_assign", {
        p_version: id(req),
        p_managers: managers,
      }),
    );
    res.sendStatus(204);
  });
  app.delete("/api/admin/reports", async (req, res) => {
    const { confirmation } = z
      .object({ confirmation: z.literal("EXCLUIR TUDO") })
      .strict()
      .parse(req.body);
    const result = await context(res).db.rpc("admin_clear_reports", {
      p_confirmation: confirmation,
    });
    if (result.error?.code === "PGRST202")
      throw new HttpError(
        503,
        "A limpeza dos relatórios depende de uma atualização do banco de dados. Solicite a aplicação da migração de limpeza dos relatórios.",
      );
    checked(result);
    res.sendStatus(204);
  });
  app.get("/api/admin/reports", async (req, res) => {
    const filters = z
      .object({
        manager: uuid.optional(),
        course: uuid.optional(),
        status: z.enum(["not_started", "in_progress", "completed"]).optional(),
        format: z.literal("csv").optional(),
      })
      .parse(req.query);
    const rows = (await assignments(context(res).db)).filter(
      (a) =>
        (!filters.manager || a.manager_id === filters.manager) &&
        (!filters.course || a.version.course_id === filters.course) &&
        (!filters.status || a.status === filters.status),
    );
    if (filters.format === "csv") {
      const header = [
        "Usuário",
        "E-mail",
        "Curso",
        "Versão",
        "Situação",
        "Progresso (%)",
        "Início",
        "Conclusão",
        "Tentativas",
        "Notas (%)",
      ];
      const lines = rows.map((a) => [
        a.manager.name,
        a.manager.email,
        a.version.title,
        a.version.version,
        a.status,
        a.progress,
        a.started_at,
        a.completion?.completed_at,
        a.attempts.length,
        a.attempts
          .map((t) => `${t.attempt}: ${Number(t.score).toFixed(2)}`)
          .join(" | "),
      ]);
      res
        .type("text/csv")
        .attachment("cifra-auditoria.csv")
        .send(
          "\uFEFF" +
            [header, ...lines]
              .map((row) => row.map(csvCell).join(","))
              .join("\r\n"),
        );
    } else res.json(rows);
  });
  app.get("/api/admin/audit", async (_req, res) =>
    res.json(
      checked(
        await context(res)
          .db.from("audit_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
      ),
    ),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Recurso não encontrado." }),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      void _next; // Express identifies error middleware by its four-argument signature.
      if (error instanceof ZodError) {
        res
          .status(400)
          .json({ error: "Dados inválidos. Confira os campos preenchidos." });
        return;
      }
      if (error instanceof multer.MulterError) {
        res.status(400).json({
          error: _req.path.startsWith("/api/admin/users/import/")
            ? "Envie apenas um CSV de até 8 MB."
            : "Envie apenas um PDF de até 20 MB.",
        });
        return;
      }
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      // Do not log request bodies, authorization headers or provider errors containing user data.
      console.error(
        "Falha inesperada na API",
        error instanceof Error ? error.name : "UnknownError",
      );
      res
        .status(500)
        .json({ error: "Não foi possível concluir. Tente novamente." });
    },
  );
  return app;
}

type ReportRow = {
  id: string;
  manager_id: string;
  started_at: string | null;
  manager: Profile;
  version: {
    title: string;
    version: number;
    page_count: number;
    course_id: string;
  };
  views: { page: number }[];
  completion: { completed_at: string } | null;
  attempts: { attempt: number; score: number; passed: boolean }[];
};
async function collectPages<T>(
  query: (offset: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string; code?: string } | null;
  }>,
) {
  const all: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const rows = checked(await query(offset)) ?? [];
    all.push(...rows);
    if (rows.length < 500) return all;
  }
}
async function assignments(db: SupabaseClient) {
  // Paginate explicitly to avoid Supabase's default 1,000-row response truncation.
  const all: ReportRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const rows = checked(
      await db
        .from("assignments")
        .select(
          "*,manager:profiles(*),version:course_versions(*),views:slide_views(page),completion:completions(*),attempts:quiz_attempts(*)",
        )
        .order("id")
        .range(offset, offset + 499),
    ) as unknown as (Omit<ReportRow, "manager"> & {
      manager: Profile | null;
    })[];
    // RLS hides administrative profiles from other admins. Preserve their history
    // for the supreme account without exposing incomplete rows or breaking CSV.
    all.push(...rows.filter((row): row is ReportRow => row.manager !== null));
    if (rows.length < 500) break;
  }
  return all.map((a) => ({
    ...a,
    status: trainingStatus(a.started_at, a.completion?.completed_at ?? null),
    progress: a.version.page_count
      ? Math.round((a.views.length * 100) / a.version.page_count)
      : 0,
  }));
}
