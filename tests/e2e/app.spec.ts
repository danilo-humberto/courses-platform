import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { renderCertificate } from "../../apps/api/src/certificates";
import type {
  Assignment,
  Course,
  Profile,
  JobPosition,
} from "../../apps/web/src/types";
const manager: Profile = {
  id: "10000000-0000-4000-8000-000000000002",
  name: "Ana Souza",
  email: "ana@example.test",
  role: "manager",
  active: true,
};
const admin: Profile = {
  ...manager,
  id: "10000000-0000-4000-8000-000000000001",
  name: "Marina Lima",
  role: "admin",
};
const course: Course = {
  id: "20000000-0000-4000-8000-000000000001",
  status: "published",
  versions: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      course_id: "20000000-0000-4000-8000-000000000001",
      title: "Cultura e valores CIFRA",
      description:
        "Conheça os princípios que orientam nossas decisões e a forma como construímos resultados juntos.",
      version: 1,
      page_count: 2,
      pdf_path: "synthetic.pdf",
      quiz_enabled: false,
      pass_score: 70,
      max_attempts: 2,
      published_at: "2026-01-01T12:00:00Z",
    },
  ],
};
const questionId = "50000000-0000-4000-8000-000000000001";
test("usuários: paginação de 20, busca e exclusão na última página", async ({
  page,
}) => {
  const f = await fixture(page, "admin");
  f.users.splice(
    0,
    f.users.length,
    ...Array.from({ length: 41 }, (_, i) => ({
      ...manager,
      id: `synthetic-user-${i}`,
      name: `Participante ${String(i + 1).padStart(2, "0")}`,
      email: `participante${i + 1}@example.test`,
    })),
  );
  await page.goto("/usuarios");
  const rows = page.locator("tbody tr");
  const previous = page.getByRole("button", { name: "Anterior", exact: true });
  const next = page.getByRole("button", { name: "Próxima", exact: true });
  await expect(rows).toHaveCount(20);
  await expect(previous).toBeDisabled();
  await expect(page.getByText("Página 1 de 3", { exact: true })).toBeVisible();
  await next.click();
  await expect(rows).toHaveCount(20);
  await expect(rows.first()).toContainText("Participante 21");
  await previous.click();
  await expect(rows.first()).toContainText("Participante 01");
  await next.click();
  await next.click();
  await expect(rows).toHaveCount(1);
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "Ver mais", exact: true }).click();
  await page
    .getByRole("button", { name: "Excluir Participante 41", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmar exclusão", exact: true })
    .click();
  await expect(rows).toHaveCount(20);
  await expect(page.getByText("Página 2 de 2", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Buscar usuário" })
    .fill("Participante 01");
  await expect(rows).toHaveCount(1);
  await expect(page.getByText("Página 1 de 1", { exact: true })).toBeVisible();
  await expect(previous).toBeDisabled();
  await expect(next).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Buscar usuário" })
    .fill("inexistente");
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("Nenhum usuário encontrado")).toBeVisible();
});
async function fixture(
  page: Page,
  role: "admin" | "manager" = "manager",
  quiz = false,
  supreme = false,
) {
  const profile = {
    ...(role === "admin" ? admin : manager),
    is_supreme: supreme,
  };
  const courses = structuredClone([course]);
  courses[0].versions[0].quiz_enabled = quiz;
  const assignment: Assignment = {
    id: "40000000-0000-4000-8000-000000000001",
    manager_id: manager.id,
    manager,
    version_id: courses[0].versions[0].id,
    version: courses[0].versions[0],
    started_at: null,
    last_slide: 1,
    views: [],
    attempts: [],
    completion: null,
    progress: 0,
    status: "not_started",
    questions: [],
  };
  const users = structuredClone([admin, manager]);
  let postCount = 0;
  let failUpload = false;
  await page.addInitScript(
    ({ profile }) => {
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: "synthetic-access-token",
          refresh_token: "synthetic-refresh-token",
          expires_at: 4102444800,
          expires_in: 3600,
          token_type: "bearer",
          user: {
            ...profile,
            aud: "authenticated",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-01-01T12:00:00Z",
          },
        }),
      );
    },
    { profile },
  );
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of [
    "CIFRA - Cultura e valores",
    "CIFRA - Nosso proximo passo",
  ]) {
    const p = pdf.addPage([800, 450]);
    p.drawText(text, { x: 70, y: 240, size: 28, font });
  }
  const pdfBytes = Buffer.from(await pdf.save());
  await page.route("**/synthetic.pdf", (r) =>
    r.fulfill({ contentType: "application/pdf", body: pdfBytes }),
  );
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api", "");
    const method = req.method();
    const ok = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path === "/me") return ok(profile);
    if (path === "/courses") return ok(courses);
    if (path === "/certificates") return ok([]);
    if (path === "/admin/users" && method === "GET") return ok(users);
    if (path === "/admin/jobs" && method === "GET") return ok([]);
    if (path.endsWith("/promote") && method === "POST") {
      users.find((u) => u.id === path.split("/").at(-2))!.role = "admin";
      return route.fulfill({ status: 204 });
    }
    if (path.startsWith("/admin/users/") && method === "DELETE") {
      const target = users.find((u) => u.id === path.split("/").at(-1))!;
      target.active = false;
      Object.assign(target, {
        deleted_at: "2026-10-23T12:00:00Z",
        auth_user_id: null,
      });
      return route.fulfill({ status: 204 });
    }
    if (path === "/admin/users" && method === "POST") {
      users.push({
        ...manager,
        ...req.postDataJSON(),
        id: crypto.randomUUID(),
        credential_pending: true,
        auth_user_id: null,
      });
      return ok({ id: users.at(-1)!.id }, 201);
    }
    if (path.startsWith("/admin/users/") && method === "PATCH") {
      Object.assign(
        users.find((u) => u.id === path.split("/").at(-1))!,
        req.postDataJSON(),
      );
      return ok(null);
    }
    if (path === "/admin/reports") {
      if (url.searchParams.get("format") === "csv")
        return route.fulfill({
          contentType: "text/csv",
          headers: {
            "Content-Disposition": 'attachment; filename="cifra-auditoria.csv"',
          },
          body: "Usuário,Curso\nAna,Cultura",
        });
      return ok(
        [assignment].filter(
          (a) =>
            !url.searchParams.get("status") ||
            a.status === url.searchParams.get("status"),
        ),
      );
    }
    if (path === "/assignments") return ok([assignment]);
    if (path === `/assignments/${assignment.id}`) return ok(assignment);
    if (path.endsWith("/pdf") && method === "GET")
      return ok({ url: "http://127.0.0.1:5174/synthetic.pdf" });
    if (path.endsWith("/start")) {
      assignment.started_at ??= new Date().toISOString();
      assignment.status = assignment.completion ? "completed" : "in_progress";
      return ok(null);
    }
    if (path.endsWith("/views")) {
      const { page: current } = req.postDataJSON();
      if (!assignment.views.some((p) => p.page === current))
        assignment.views.push({ page: current });
      assignment.last_slide = current;
      assignment.progress = assignment.views.length * 50;
      if (assignment.progress === 100 && quiz)
        assignment.questions = [
          {
            id: questionId,
            prompt: "Como construímos resultados?",
            options: ["Juntos", "Sozinhos"],
          },
        ];
      return ok(null);
    }
    if (path.endsWith("/complete")) {
      assignment.completion = { completed_at: new Date().toISOString() };
      assignment.status = "completed";
      return ok(null);
    }
    if (path.endsWith("/attempts")) {
      const pass = req.postDataJSON().answers[questionId] === 0;
      const attempt = {
        id: crypto.randomUUID(),
        attempt: assignment.attempts.length + 1,
        score: pass ? 100 : 0,
        passed: pass,
        submitted_at: new Date().toISOString(),
      };
      assignment.attempts.push(attempt);
      if (pass) {
        assignment.completion = { completed_at: attempt.submitted_at };
        assignment.status = "completed";
      }
      return ok(attempt);
    }
    if (path === "/admin/courses" && method === "POST") {
      postCount++;
      const cid = crypto.randomUUID();
      const vid = crypto.randomUUID();
      courses.push({
        id: cid,
        status: "draft",
        versions: [
          {
            ...course.versions[0],
            ...req.postDataJSON(),
            id: vid,
            course_id: cid,
            pdf_path: null,
            page_count: 0,
            published_at: null,
          },
        ],
      });
      return ok({ course_id: cid, version_id: vid }, 201);
    }
    if (path.endsWith("/draft")) {
      const c = courses.find((c) => path.includes(c.id))!;
      Object.assign(c.versions[0], req.postDataJSON());
      return ok({ course_id: c.id, version_id: c.versions[0].id });
    }
    if (path.endsWith("/pdf") && method === "POST") {
      if (failUpload) {
        failUpload = false;
        return ok({ error: "Falha temporária no upload." }, 500);
      }
      const c = courses.find((c) => path.includes(c.versions[0].id))!;
      c.versions[0].pdf_path = "synthetic.pdf";
      c.versions[0].page_count = 2;
      return ok({ page_count: 2 });
    }
    if (path.endsWith("/publish")) {
      const c = courses.find((c) => path.includes(c.versions[0].id))!;
      c.status = "published";
      c.versions[0].published_at = new Date().toISOString();
      return ok(null);
    }
    if (path.endsWith("/assign")) return ok(null);
    return ok({ error: `Unmocked endpoint: ${path}` }, 404);
  });
  return {
    users,
    assignment,
    pdfBytes,
    courses,
    getPostCount: () => postCount,
    failNextUpload: () => {
      failUpload = true;
    },
  };
}
async function jobsFixture(page: Page) {
  const f = await fixture(page, "admin");
  const jobs: JobPosition[] = [
    {
      id: "70000000-0000-4000-8000-000000000001",
      name: "Analista",
      description: "Equipe técnica",
    },
  ];
  f.users.push({
    ...manager,
    id: "10000000-0000-4000-8000-000000000003",
    name: "Bia Lima",
    email: "bia@example.test",
  });
  let failAssignment = false;
  await page.route("**/api/admin/jobs**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body =
      req.method() === "GET" || req.method() === "DELETE"
        ? null
        : req.postDataJSON();
    if (req.method() === "GET") return route.fulfill({ json: jobs });
    if (path.endsWith("/assign")) {
      if (failAssignment) {
        failAssignment = false;
        return route.fulfill({
          status: 400,
          json: {
            error: "Um dos usuários está inativo. Nenhum cargo foi alterado.",
          },
        });
      }
      const job = jobs.find((item) => path.includes(item.id))!;
      for (const user of f.users.filter((item) =>
        body.users.includes(item.id),
      )) {
        user.job_id = job.id;
        user.job = { id: job.id, name: job.name };
      }
      return route.fulfill({ status: 204 });
    }
    if (req.method() === "POST") {
      if (
        jobs.some(
          (job) => job.name.toLowerCase() === body.name.trim().toLowerCase(),
        )
      )
        return route.fulfill({
          status: 400,
          json: { error: "Já existe um cargo com esse nome." },
        });
      const created = { id: "70000000-0000-4000-8000-000000000002", ...body };
      jobs.push(created);
      return route.fulfill({ status: 201, json: { id: created.id } });
    }
    const job = jobs.find((item) => path.endsWith(item.id))!;
    if (req.method() === "PATCH") {
      Object.assign(job, body);
      for (const user of f.users.filter((item) => item.job_id === job.id))
        user.job = { id: job.id, name: job.name };
    }
    if (req.method() === "DELETE") {
      jobs.splice(jobs.indexOf(job), 1);
      for (const user of f.users.filter((item) => item.job_id === job.id)) {
        user.job_id = null;
        user.job = null;
      }
    }
    return route.fulfill({ status: 204 });
  });
  return {
    ...f,
    jobs,
    failNextAssignment: () => {
      failAssignment = true;
    },
  };
}

test("cargos: CRUD e atribuição em lote substituem cargo e preservam usuários", async ({
  page,
}) => {
  const f = await jobsFixture(page);
  await page.goto("/cargos");
  await expect(
    page.getByRole("button", { name: "Atribuir Analista", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/jobs-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Atribuir Analista", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /Ana Souza/ }).check();
  await page.getByRole("checkbox", { name: /Bia Lima/ }).check();
  await page
    .getByRole("button", { name: "Atribuir a 2 usuário(s)", exact: true })
    .click();
  await expect(
    page.getByText("Cargo atribuído a 2 usuário(s).", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Atribuir Analista", exact: true })
    .click();
  await expect(page.getByRole("checkbox", { name: /Ana Souza/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Bia Lima/ })).toBeDisabled();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("button", { name: "Cadastrar cargo", exact: true })
    .click();
  await page.getByLabel("Nome do cargo").fill("Engenheiro");
  await page.getByLabel("Descrição", { exact: true }).fill("Obras");
  await page.getByRole("button", { name: "Salvar cargo", exact: true }).click();
  await page
    .getByRole("button", { name: "Atribuir Engenheiro", exact: true })
    .click();
  await expect(page.getByText("Cargo atual: Analista")).toHaveCount(2);
  await page.getByRole("checkbox", { name: /Ana Souza/ }).check();
  await page
    .getByRole("button", { name: "Atribuir a 1 usuário(s)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Editar Engenheiro", exact: true })
    .click();
  await page.getByLabel("Nome do cargo").fill("Engenheiro civil");
  await page.getByRole("button", { name: "Salvar cargo", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Editar Engenheiro civil", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Usuários", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Ana Souza" })
    .getByRole("button", { name: "Ver mais" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Engenheiro civil");
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Bia Lima" })
    .getByRole("button", { name: "Ver mais" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Analista");
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("link", { name: "Cargos", exact: true }).click();
  await page
    .getByRole("button", { name: "Excluir Engenheiro civil", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(f.jobs).toHaveLength(2);
  await page
    .getByRole("button", { name: "Excluir Engenheiro civil", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmar exclusão", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Editar Engenheiro civil", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Usuários", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Ana Souza" })
    .getByRole("button", { name: "Ver mais" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Sem função");
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Bia Lima" })
    .getByRole("button", { name: "Ver mais" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Analista");
});

test("cargos: falhas preservam seleção e cadastro; busca mantém selecionados", async ({
  page,
}) => {
  const f = await jobsFixture(page);
  await page.goto("/cargos");
  await page
    .getByRole("button", { name: "Cadastrar cargo", exact: true })
    .click();
  await page.getByLabel("Nome do cargo").fill("Analista");
  await page.getByRole("button", { name: "Salvar cargo", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Já existe um cargo com esse nome.",
  );
  await expect(page.getByLabel("Nome do cargo")).toHaveValue("Analista");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("button", { name: "Atribuir Analista", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /Ana Souza/ }).check();
  await page
    .getByRole("textbox", { name: "Buscar usuário para atribuir cargo" })
    .fill("Bia");
  await page.getByRole("checkbox", { name: /Bia Lima/ }).check();
  f.failNextAssignment();
  await page
    .getByRole("button", { name: "Atribuir a 2 usuário(s)", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Nenhum cargo foi alterado.",
  );
  await expect(
    page.getByRole("button", { name: "Atribuir a 2 usuário(s)", exact: true }),
  ).toBeEnabled();
  expect(f.users.filter((user) => user.job_id)).toHaveLength(0);
  await page
    .getByRole("button", { name: "Atribuir a 2 usuário(s)", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("cargos: consulta falha com retry e usuários comuns não acessam gestão", async ({
  page,
}) => {
  await jobsFixture(page);
  await page.goto("/cargos");
  await expect(
    page.getByRole("button", { name: "Atribuir Analista", exact: true }),
  ).toBeVisible();
  const fail = (route: import("@playwright/test").Route) =>
    route.fulfill({ status: 503, json: { error: "Consulta indisponível" } });
  await page.route("**/api/admin/users", fail);
  await page
    .getByRole("button", { name: "Atribuir Analista", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Tentar novamente", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.unroute("**/api/admin/users", fail);
  await page
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await expect(page.getByRole("checkbox", { name: /Ana Souza/ })).toBeEnabled();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await fixture(page, "manager");
  await page.goto("/cargos");
  await expect(
    page.getByRole("link", { name: "Meus treinamentos", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Cargos", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cadastrar cargo", exact: true }),
  ).toHaveCount(0);
});

test("atribuição mostra vínculos salvos e atualiza ao reabrir", async ({
  page,
}) => {
  const f = await fixture(page, "admin");
  let assigned = false;
  await page.route("**/api/assignments", (route) =>
    route.fulfill({ json: assigned ? [f.assignment] : [] }),
  );
  await page.route(
    `**/api/admin/versions/${f.assignment.version_id}/assign`,
    (route) => {
      expect(route.request().postDataJSON()).toEqual({
        managers: [manager.id],
      });
      assigned = true;
      return route.fulfill({ json: null });
    },
  );
  await page.goto("/cursos");
  await page.getByRole("button", { name: "Atribuir", exact: true }).click();
  const checkbox = page.getByRole("checkbox", { name: /Ana Souza/ });
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await page
    .getByRole("button", { name: "Atribuir a 1 usuário(s)", exact: true })
    .click();
  await page.getByRole("button", { name: "Atribuir", exact: true }).click();
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeDisabled();
  await expect(page.getByText("Já atribuído", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Atribuir a 0 usuário(s)" }),
  ).toBeDisabled();
});

test("atribuição considera somente a versão selecionada", async ({ page }) => {
  const f = await fixture(page, "admin");
  f.assignment.version_id = "30000000-0000-4000-8000-000000000099";
  await page.goto("/cursos");
  await page.getByRole("button", { name: "Atribuir", exact: true }).click();
  const checkbox = page.getByRole("checkbox", { name: /Ana Souza/ });
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).not.toBeChecked();
});

test("falha ao consultar atribuições bloqueia seleção e permite tentar novamente", async ({
  page,
}) => {
  await fixture(page, "admin");
  await page.goto("/cursos");
  await page.route("**/api/assignments", (route) =>
    route.fulfill({
      status: 500,
      json: { error: "Falha ao carregar atribuições." },
    }),
  );
  await page.getByRole("button", { name: "Atribuir", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Atribuir a 0 usuário(s)" }),
  ).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /Ana Souza/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Tentar novamente" }),
  ).toBeVisible();
  await page.unroute("**/api/assignments");
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByRole("checkbox", { name: /Ana Souza/ })).toBeChecked();
});

test("exclusão de curso confirma, cancela e preserva arquivamento", async ({
  page,
}) => {
  const f = await fixture(page, "admin");
  let deletes = 0;
  await page.route(`**/api/admin/courses/${course.id}`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      delete_assignments: false,
    });
    deletes++;
    f.courses.splice(0, 1);
    await route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Cursos", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Arquivar ${course.versions[0].title}` }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Excluir ${course.versions[0].title}` })
    .click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(deletes).toBe(0);
  await page
    .getByRole("button", { name: `Excluir ${course.versions[0].title}` })
    .click();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page.getByText("Curso excluído com sucesso.")).toBeVisible();
  await expect(page.getByText("Nenhum curso por aqui")).toBeVisible();
  expect(deletes).toBe(1);
  await page.reload();
  await expect(page.getByText("Nenhum curso por aqui")).toBeVisible();
});
test("checkbox permite excluir curso com atribuições e reinicia ao reabrir", async ({
  page,
}) => {
  const f = await fixture(page, "admin");
  let calls = 0;
  await page.route(`**/api/admin/courses/${course.id}`, async (route) => {
    calls++;
    if (!route.request().postDataJSON().delete_assignments)
      return route.fulfill({
        status: 400,
        json: {
          error: "Marque a opção de apagar as atribuições ou use Arquivar.",
        },
      });
    f.courses.splice(0, 1);
    return route.fulfill({ status: 204 });
  });
  await page.goto("/cursos");
  const remove = page.getByRole("button", {
    name: `Excluir ${course.versions[0].title}`,
  });
  await remove.click();
  const checkbox = page.getByRole("checkbox", {
    name: /Apagar também as atribuições/,
  });
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(calls).toBe(0);
  await remove.click();
  await expect(checkbox).not.toBeChecked();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(
    page
      .locator(".error")
      .getByText("Marque a opção de apagar as atribuições ou use Arquivar.", {
        exact: true,
      }),
  ).toBeVisible();
  await expect(remove).toBeVisible();
  await checkbox.check();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page.getByText("Curso excluído com sucesso.")).toBeVisible();
  await expect(page.getByText("Nenhum curso por aqui")).toBeVisible();
  expect(calls).toBe(2);
});
test("curso atribuído mantém card após exclusão negada e pode ser arquivado", async ({
  page,
}) => {
  const f = await fixture(page, "admin");
  await page.route(`**/api/admin/courses/${course.id}`, (route) =>
    route.fulfill({
      status: 400,
      json: {
        error:
          "Curso possui atribuições. Use Arquivar para preservar o histórico.",
      },
    }),
  );
  await page.route(`**/api/admin/courses/${course.id}/archive`, (route) => {
    f.courses[0].status = "archived";
    return route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Cursos", exact: true }).click();
  await page
    .getByRole("button", { name: `Excluir ${course.versions[0].title}` })
    .click();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(
    page
      .getByRole("dialog")
      .locator(".error")
      .getByText(
        "Curso possui atribuições. Use Arquivar para preservar o histórico.",
      ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: `Arquivar ${course.versions[0].title}` })
    .click();
  await expect(
    page.getByText("Curso arquivado. O histórico foi preservado."),
  ).toBeVisible();
  await expect(
    page.getByRole("article").getByText("Arquivado", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Excluir ${course.versions[0].title}` }),
  ).toBeVisible();
});
test("exclusão antiga ou pendente permite concluir remoção do Auth", async ({
  page,
}) => {
  const f = await fixture(page, "admin");
  Object.assign(
    f.users.find((u) => u.id === manager.id)!,
    {
      active: false,
      deleted_at: "2026-10-23T12:00:00Z",
      auth_user_id: manager.id,
    },
  );
  await page.goto("/usuarios");
  await expect(page.getByText("Exclusão pendente")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Editar", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Ver mais", exact: true }).click();
  await page.getByRole("button", { name: `Excluir ${manager.name}` }).click();
  await expect(
    page.getByText(/A conta de login será apagada do Supabase Auth/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(
    page.getByText(
      "Usuário excluído. O e-mail foi liberado e o histórico preservado.",
    ),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("Nenhum usuário encontrado")).toBeVisible();
});
test("limpeza global confirma, cancela e trata falhas", async ({ page }) => {
  await fixture(page, "admin");
  let deletes = 0;
  let fail = true;
  let cleared = false;
  await page.route("**/api/admin/reports**", async (route) => {
    if (route.request().method() === "DELETE") {
      deletes++;
      expect(new URL(route.request().url()).search).toBe("");
      expect(route.request().postDataJSON()).toEqual({
        confirmation: "EXCLUIR TUDO",
      });
      if (fail)
        return route.fulfill({
          status: 503,
          json: { error: "Limpeza indisponível" },
        });
      cleared = true;
      return route.fulfill({ status: 204 });
    }
    if (cleared) return route.fulfill({ json: [] });
    return route.fallback();
  });
  await page.goto("/relatorios");
  const clear = page.getByRole("button", { name: "Limpar dados" });
  await expect(clear).toBeEnabled();
  const modal = page.getByRole("dialog", { name: "Limpar todos os dados?" });
  await clear.click();
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("independentemente dos filtros");
  await modal.getByRole("button", { name: "Cancelar" }).click();
  await expect(modal).not.toBeVisible();
  expect(deletes).toBe(0);
  await clear.click();
  await page.keyboard.press("Escape");
  await expect(modal).not.toBeVisible();
  await clear.click();
  await modal.getByRole("button", { name: "Excluir tudo" }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Limpeza indisponível");
  await expect(page.locator(".error")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Ana Souza" })).toBeVisible();
  await page.getByLabel("Situação", { exact: true }).selectOption("completed");
  await expect(page.getByText("Nenhum resultado")).toBeVisible();
  fail = false;
  await clear.click();
  await page.screenshot({ path: "test-results/clear-reports-modal.png" });
  await modal.getByRole("button", { name: "Excluir tudo" }).click();
  await expect(modal).not.toBeVisible();
  await expect(
    page.getByText("Todos os dados dos relatórios foram excluídos."),
  ).toBeVisible();
  expect(deletes).toBe(2);
  await page.reload();
  await expect(page.getByText("Nenhum resultado")).toBeVisible();
});

test("dashboard administrativo e exportação filtrada", async ({ page }) => {
  await fixture(page, "admin");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Visão geral" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Treinamentos por usuário" }),
  ).toHaveCount(0);
  await expect(page.getByText("Cultura e valores CIFRA")).toBeVisible();
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page.getByRole("link", { name: "Relatórios", exact: true }).click();
  await page.getByLabel("Situação", { exact: true }).selectOption("completed");
  await expect(page.getByText("Nenhum resultado")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV" }).click();
  expect((await download).suggestedFilename()).toBe("cifra-auditoria.csv");
});
test("PDF renderiza, salva, retoma e exige confirmação", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(`/treinamento/${f.assignment.id}`);
  await expect(
    page.getByText("Progresso salvo", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirmar conclusão" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page.getByText("2 de 2 slides visualizados")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Slide 2 de 2", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Progresso salvo", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirmar conclusão" }).click();
  await expect(page.getByText("Treinamento concluído!")).toBeVisible();
  await page.screenshot({ path: "test-results/training.png", fullPage: true });
});
test("questionário reprova e depois conclui com aprovação", async ({
  page,
}) => {
  const f = await fixture(page, "manager", true);
  await page.goto(`/treinamento/${f.assignment.id}`);
  await expect(
    page.getByText("Progresso salvo", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Próximo" }).click();
  await page.getByLabel("Sozinhos").check();
  await page.getByRole("button", { name: "Enviar respostas" }).click();
  await expect(
    page.getByText(/A nota mínima ainda não foi atingida/),
  ).toBeVisible();
  await page.getByLabel("Juntos").check();
  await page.getByRole("button", { name: "Enviar respostas" }).click();
  await expect(page.getByText("Treinamento concluído!")).toBeVisible();
});
test("criação de curso repete upload sem duplicar rascunho", async ({
  page,
}) => {
  const f = await fixture(page, "admin");
  f.failNextUpload();
  await page.goto("/cursos");
  await page.getByRole("button", { name: "Criar curso", exact: true }).click();
  await page.getByLabel("Título do curso").fill("Segurança da informação");
  await page
    .getByLabel("Descrição", { exact: true })
    .fill("Boas práticas para proteger nossa equipe.");
  await page.getByLabel("Apresentação PDF", { exact: true }).setInputFiles({
    name: "curso.pdf",
    mimeType: "application/pdf",
    buffer: f.pdfBytes,
  });
  await page.getByRole("button", { name: "Publicar curso" }).click();
  await expect(
    page.locator(".error").getByText("Falha temporária no upload."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publicar curso" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Segurança da informação" }),
  ).toBeVisible();
  expect(f.getPostCount()).toBe(1);
});
test("cancelar seleção de PDF mantém o formulário e Escape fecha o modal", async ({
  page,
}) => {
  await fixture(page, "admin");
  await page.goto("/cursos");
  await page.getByRole("button", { name: "Criar curso", exact: true }).click();
  await page.getByLabel("Título do curso").fill("Curso preservado");
  // O seletor nativo emite cancel no input; esse evento propaga até o dialog.
  await page
    .getByLabel("Apresentação PDF", { exact: true })
    .dispatchEvent("cancel", { bubbles: true });
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Título do curso")).toHaveValue(
    "Curso preservado",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("renovação da sessão preserva o formulário aberto", async ({ page }) => {
  await fixture(page, "admin");
  await page.goto("/cursos");
  await page.getByRole("button", { name: "Criar curso", exact: true }).click();
  await page.getByLabel("Título do curso").fill("Rascunho preservado");
  for (const event of ["SIGNED_IN", "TOKEN_REFRESHED"]) {
    const refreshed = page.waitForResponse("**/api/me");
    await page.evaluate((event) => {
      const channel = new BroadcastChannel("sb-127-auth-token");
      channel.postMessage({
        event,
        session: JSON.parse(localStorage.getItem("sb-127-auth-token")!),
      });
      channel.close();
    }, event);
    await refreshed;
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByLabel("Título do curso")).toHaveValue(
      "Rascunho preservado",
    );
  }
});

test("exclusão exige confirmação e preserva relatórios", async ({ page }) => {
  await fixture(page, "admin");
  await page.goto("/usuarios");
  await page.getByRole("button", { name: "Ver mais", exact: true }).click();
  await page.getByRole("button", { name: "Excluir Ana Souza" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "histórico de treinamentos será preservado",
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Ver mais", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ver mais", exact: true }).click();
  await page.getByRole("button", { name: "Excluir Ana Souza" }).click();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Usuário excluído. O e-mail foi liberado e o histórico preservado.",
  );
  await page.getByRole("button", { name: "Fechar notificação" }).click();
  await expect(
    page.getByText(
      "Usuário excluído. O e-mail foi liberado e o histórico preservado.",
    ),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Nenhum usuário encontrado")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Nenhum usuário encontrado")).toBeVisible();
  await page.goto("/relatorios");
  await expect(page.getByRole("table")).toContainText("Ana Souza");
});

test("falha na exclusão mantém usuário e permite tentar novamente", async ({
  page,
}) => {
  const f = await fixture(page, "admin");
  await page.route(`**/api/admin/users/${manager.id}`, (route) => {
    Object.assign(
      f.users.find((u) => u.id === manager.id)!,
      {
        active: false,
        deleted_at: "2026-10-23T12:00:00Z",
        auth_user_id: manager.id,
      },
    );
    return route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Falha simulada" }),
    });
  });
  await page.goto("/usuarios");
  await page.getByRole("button", { name: "Ver mais", exact: true }).click();
  await page.getByRole("button", { name: "Excluir Ana Souza" }).click();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page.getByRole("dialog")).toContainText("Falha simulada");
  await expect(page.locator(".system-toast")).toContainText("Falha simulada");
  await page.screenshot({
    path: "test-results/toast-error.png",
    fullPage: true,
  });
  await expect(page.locator(".system-toast")).toContainText(
    "Não foi possível concluir",
  );
  await page.getByRole("button", { name: "Fechar notificação" }).click();
  await expect(page.locator(".system-toast")).toHaveCount(0);
  await expect(page.getByRole("dialog").locator(".error")).toContainText(
    "Falha simulada",
  );
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page.locator(".system-toast")).toContainText("Falha simulada");
  await expect(
    page.getByText(
      "Usuário excluído. O e-mail foi liberado e o histórico preservado.",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirmar exclusão" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByText("Exclusão pendente")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Editar", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Ver mais", exact: true }),
  ).toBeVisible();
});

test("endereço antigo de gerentes redireciona para usuários", async ({
  page,
}) => {
  await fixture(page, "admin");
  await page.goto("/gerentes");
  await expect(page).toHaveURL(/\/usuarios$/);
  await expect(
    page.getByRole("heading", { name: "Usuários", exact: true }),
  ).toBeVisible();
});

test("cadastro e desativação de usuário", async ({ page }) => {
  await fixture(page, "admin");
  await page.goto("/usuarios");
  await page.getByRole("button", { name: "Cadastrar usuário" }).click();
  await page.getByLabel("Nome completo").fill("Carlos Teste");
  await page.getByLabel("E-mail corporativo").fill("carlos@example.test");
  await page.getByLabel("CPF", { exact: true }).fill("01234567890");
  await page.getByRole("button", { name: "Salvar usuário" }).click();
  await expect(page.getByText("Carlos Teste", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Usuário cadastrado com sucesso.",
  );
  await page
    .getByRole("row")
    .filter({ hasText: "Carlos Teste" })
    .getByRole("button", { name: "Ver mais" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Editar", exact: true })
    .click();
  await page.getByLabel("Acesso ativo").uncheck();
  await page.getByRole("button", { name: "Salvar usuário" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Usuário atualizado com sucesso.",
  );
  await page.screenshot({
    path: "test-results/toast-success.png",
    fullPage: true,
  });
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "Carlos Teste" })
      .getByText("Desativado"),
  ).toBeVisible();
});

test("cadastro sem e-mail e geração da senha inicial", async ({ page }) => {
  await fixture(page, "admin");
  let credentialRequest = 0;
  await page.route("**/api/admin/users/*/password", (route) => {
    credentialRequest++;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ password: "Synthetic-only-Password-123!" }),
    });
  });
  await page.goto("/usuarios");
  await page
    .getByRole("button", { name: "Cadastrar usuário", exact: true })
    .click();
  await page.getByLabel("Nome completo").fill("Funcionário Sintético");
  await page.getByLabel("CPF", { exact: true }).fill("01234567890");
  await expect(page.getByLabel("Senha inicial")).toHaveCount(0);
  await page.getByRole("button", { name: "Salvar usuário" }).click();
  const row = page
    .getByRole("row")
    .filter({ hasText: "Funcionário Sintético" });
  await expect(row).toContainText("Sem senha");
  await row.getByRole("button", { name: "Gerar senha" }).click();
  expect(credentialRequest).toBe(0);
  await page.getByRole("button", { name: "Confirmar geração" }).click();
  await expect(page.getByLabel("Senha gerada")).toHaveValue(
    "Synthetic-only-Password-123!",
  );
  expect(credentialRequest).toBe(1);
  await page
    .getByRole("button", { name: "Fechar", exact: true })
    .last()
    .click();
  await expect(page.getByLabel("Senha gerada")).toHaveCount(0);
});

test("resposta perdida permite gerar nova senha com confirmação explícita", async ({
  page,
}) => {
  const f = await fixture(page, "admin");
  const target = f.users.find((user) => user.role === "manager")!;
  Object.assign(target, {
    cpf: "01234567890",
    credential_pending: true,
    auth_user_id: null,
  });
  let attempts = 0;
  await page.route("**/api/admin/users/*/password", (route) => {
    attempts++;
    if (attempts === 1) {
      Object.assign(target, {
        credential_pending: false,
        auth_user_id: target.id,
      });
      return route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Resposta perdida após geração." }),
      });
    }
    expect(route.request().postDataJSON()).toEqual({ reset: true });
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ password: "Replacement-synthetic-123!" }),
    });
  });
  await page.goto("/usuarios");
  await page.getByRole("button", { name: "Gerar senha", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar geração" }).click();
  await expect(
    page.getByRole("alert").getByText("Resposta perdida após geração."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Fechar", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Gerar nova senha" }).click();
  await expect(
    page.getByText(/A senha anterior deixará de funcionar/),
  ).toBeVisible();
  expect(attempts).toBe(1);
  await page.getByRole("button", { name: "Confirmar geração" }).click();
  await expect(page.getByLabel("Senha gerada")).toHaveValue(
    "Replacement-synthetic-123!",
  );
  expect(attempts).toBe(2);
});

test("importação exibe limpeza antes de confirmar e resultado por registro", async ({
  page,
}) => {
  await fixture(page, "admin");
  let confirmed = false;
  const preview = {
    total: 3,
    dismissed: 1,
    rows: [
      {
        row: 2,
        data: {
          name: "Ana Importada",
          email: "",
          cpf: "01234567890",
          state: "PE",
          cost_center: "TI",
          job_name: "Analista",
        },
        errors: [],
      },
      {
        row: 3,
        data: {
          name: "CPF inválido",
          email: "",
          cpf: "123",
          state: "PE",
          cost_center: "TI",
          job_name: "Analista",
        },
        errors: ["CPF deve conter 11 dígitos."],
      },
    ],
  };
  await page.route("**/api/admin/users/import/*", (route) => {
    confirmed = route.request().url().endsWith("/confirm");
    if (confirmed)
      expect(route.request().postData()).toContain(
        'name="ignorePending"\r\n\r\ntrue',
      );
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...preview,
        ...(confirmed ? { results: [{ row: 2, status: "created" }] } : {}),
      }),
    });
  });
  await page.goto("/usuarios");
  await page.getByRole("button", { name: "Importar base" }).click();
  await page.getByLabel("Base de funcionários").setInputFiles({
    name: "synthetic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("synthetic"),
  });
  await page.getByRole("button", { name: "Analisar e limpar" }).click();
  await expect(
    page.getByRole("status", { name: "Resumo da limpeza" }),
  ).toContainText(
    "3Registros na base1Desligados ignorados1Aptos para cadastro1Com pendências",
  );
  expect(confirmed).toBe(false);
  await expect(page.getByText("CPF deve conter 11 dígitos.")).toBeVisible();
  const pendingCard = page.getByRole("button", { name: /Com pendências/ });
  await pendingCard.click();
  await expect(pendingCard).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("cell", { name: "Ana Importada", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "CPF inválido", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cadastrar 1 funcionários" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Ignorar pendências", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cadastrar 1 funcionários" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Reconsiderar pendências", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cadastrar 1 funcionários" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Ignorar pendências", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mostrar todos", exact: true })
    .click();
  await expect(pendingCard).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("cell", { name: "Ana Importada", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cadastrar 1 funcionários" }).click();
  await expect(
    page.getByText("Importação concluída: 1 cadastrados; 0 já existentes."),
  ).toBeVisible();
  expect(confirmed).toBe(true);
  await page.screenshot({
    path: "test-results/employee-import.png",
    fullPage: true,
  });
});

test("filtro de pendências reinicia paginação e limpa ao trocar arquivo", async ({
  page,
}) => {
  await fixture(page, "admin");
  let previews = 0;
  await page.route("**/api/admin/users/import/preview", (route) => {
    previews++;
    const rows = Array.from({ length: 27 }, (_, index) => ({
      row: index + 2,
      data: {
        name: `Pessoa ${index + 1}`,
        email: "",
        cpf: "01234567890",
        state: "PE",
        cost_center: "TI",
        job_name: "Analista",
      },
      errors: previews <= 2 && index === 0 ? ["CPF duplicado no arquivo."] : [],
    }));
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ total: 27, dismissed: 0, rows }),
    });
  });
  await page.goto("/usuarios");
  await page.getByRole("button", { name: "Importar base" }).click();
  const upload = page.getByLabel("Base de funcionários");
  await upload.setInputFiles({
    name: "synthetic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("synthetic"),
  });
  await page.getByRole("button", { name: "Analisar e limpar" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Próxima", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("Página 2 de 2"),
  ).toBeVisible();
  const pending = page.getByRole("button", { name: /Com pendências/ });
  await pending.press("Enter");
  await expect(
    page.getByRole("dialog").getByText("Página 1 de 1"),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Pessoa 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Pessoa 27", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Próxima", exact: true }),
  ).toBeDisabled();
  await pending.press("Space");
  await expect(
    page.getByRole("dialog").getByText("Página 1 de 2"),
  ).toBeVisible();
  await pending.click();
  await page.screenshot({
    path: "test-results/employee-pending-filter.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Ignorar pendências", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cadastrar 26 funcionários" }),
  ).toBeEnabled();
  await upload.setInputFiles({
    name: "another.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("synthetic"),
  });
  await page.getByRole("button", { name: "Analisar e limpar" }).click();
  await expect(
    page.getByRole("button", { name: "Cadastrar 26 funcionários" }),
  ).toBeDisabled();
  await upload.setInputFiles({
    name: "corrected.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("synthetic"),
  });
  await page.getByRole("button", { name: "Analisar e limpar" }).click();
  await expect(pending).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Cadastrar 27 funcionários" }),
  ).toBeEnabled();
  await expect(pending).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "Mostrar todos", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog").getByText("Página 1 de 2"),
  ).toBeVisible();
});

test("login converte CPF para identidade interna sem chamar API real", async ({
  page,
}) => {
  let submitted: { email: string; password: string } | undefined;
  await page.route("**/auth/v1/**", (route) => {
    if (route.request().method() === "POST")
      submitted = route.request().postDataJSON();
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "invalid_grant",
        error_description: "Invalid login credentials",
      }),
    });
  });
  await page.goto("/");
  await page.getByLabel("CPF ou e-mail").fill("01234567890");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("Synthetic-only-Password-123!");
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  await expect(
    page
      .getByRole("alert")
      .getByText("CPF, e-mail ou senha inválidos. Confira e tente novamente."),
  ).toBeVisible();
  expect(submitted?.email).toBe("01234567890@cifraengenharia.com.br");
});
test("usuário tem navegação própria e layout móvel sem overflow", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Meus treinamentos" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/meus-cursos$/);
  await expect(
    page.getByRole("link", { name: "Minha jornada", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await expect(
    page.getByRole("link", { name: "Usuários", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Meus treinamentos", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Meus treinamentos" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  await page.goto("/usuarios");
  await expect(
    page.getByRole("heading", { name: "Meus treinamentos" }),
  ).toBeVisible();
});
test("erro de carregamento mostra toast acessível e mantém aviso na página", async ({
  page,
}) => {
  await fixture(page, "admin");
  await page.route("**/api/admin/users", (route) =>
    route.fulfill({
      status: 500,
      json: { error: "Não foi possível carregar os usuários." },
    }),
  );
  await page.goto("/usuarios");
  await expect(page.getByRole("alert")).toContainText(
    "Não foi possível carregar os usuários.",
  );
  await expect(page.locator(".toast-error")).toBeVisible();
  await page.getByRole("button", { name: "Fechar notificação" }).click();
  await expect(page.locator(".system-toast")).toHaveCount(0);
  await expect(page.locator(".error")).toContainText(
    "Não foi possível carregar os usuários.",
  );
});
test("login e recuperação apresentam mensagem genérica", async ({ page }) => {
  await page.route("**/auth/v1/recover*", (r) =>
    r.fulfill({ contentType: "application/json", body: "{}" }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bom ter você por aqui." }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/login.png", fullPage: true });
  await page.getByRole("button", { name: "Esqueci minha senha" }).click();
  await page.getByLabel("CPF ou e-mail").fill("unknown@example.test");
  await page.getByRole("button", { name: "Enviar instruções" }).click();
  await expect(page.getByText(/Se o e-mail estiver cadastrado/)).toBeVisible();
});

test("filtro de relatórios não lista usuários excluídos", async ({ page }) => {
  await fixture(page, "admin");
  const deleted = {
    ...manager,
    deleted_at: "2026-10-26T12:00:00Z",
    auth_user_id: null,
    active: false,
  };
  let profiles = [admin, deleted];
  await page.route("**/api/admin/users", (route) =>
    route.fulfill({ json: profiles }),
  );
  await page.goto("/relatorios");
  const filter = page.getByRole("combobox", { name: "Usuário", exact: true });
  await expect(
    page.getByRole("button", { name: "Limpar dados" }),
  ).toBeEnabled();
  await expect(filter.locator("option")).toHaveText(["Todos os usuários"]);
  profiles = [admin, { ...manager, active: false }];
  await page.reload();
  await expect(filter.locator("option")).toHaveText([
    "Todos os usuários",
    manager.name,
  ]);
});

test("conta suprema promove com confirmação e preserva telas administrativas", async ({
  page,
}) => {
  await fixture(page, "admin", false, true);
  await page.goto("/usuarios");
  await expect(page.getByText("Conta suprema", { exact: true })).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: "Ana Souza" })
    .getByRole("button", { name: "Ver mais" })
    .click();
  await page
    .getByRole("button", { name: "Tornar administrador", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Ana Souza");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Ana Souza" })
    .getByRole("button", { name: "Ver mais" })
    .click();
  await expect(
    page.getByRole("button", { name: "Tornar administrador", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Tornar administrador", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmar promoção", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: "Ana Souza" });
  await expect(row).toContainText("Administrador");
  await expect(row.getByRole("button")).toHaveText(["Ver mais"]);
});

test("admin comum não vê promoção nem outras contas administrativas", async ({
  page,
}) => {
  await fixture(page, "admin");
  await page.goto("/usuarios");
  await expect(
    page.getByRole("row").filter({ hasText: "Ana Souza" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Marina Lima" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Tornar administrador", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Cursos", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Cargos", exact: true }),
  ).toBeVisible();
});

test("usuários: colunas resumidas e detalhes completos no modal", async ({
  page,
}) => {
  const f = await fixture(page, "admin", false, true);
  Object.assign(f.users[1], {
    cpf: "01234567890",
    state: "PE",
    cost_center: "Recife",
    job: { id: "job-test", name: "Analista" },
  });
  await page.goto("/usuarios");
  await expect(page.getByRole("columnheader")).toHaveText([
    "Participante",
    "Cargo",
    "CPF",
    "Estado",
    "Centro de custo",
    "Acesso",
    "Ações",
  ]);
  const row = page.getByRole("row").filter({ hasText: "Ana Souza" });
  await expect(row.locator("td").first()).toHaveText("Ana Souza");
  await expect(row.getByRole("button")).toHaveText([
    "Gerar nova senha",
    "Ver mais",
  ]);
  await expect(row.locator("button svg")).toHaveCount(2);
  await row.getByRole("button", { name: "Ver mais" }).click();
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByRole("button", { name: "Tornar administrador", exact: true }),
  ).toBeVisible();
  for (const value of [
    "Ana Souza",
    "ana@example.test",
    "Funcionário",
    "Analista",
    "01234567890",
    "PE",
    "Recife",
    "Ativo",
  ]) {
    await expect(modal.getByText(value, { exact: true })).toBeVisible();
  }
  await expect(
    modal.getByRole("button", { name: "Editar", exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Excluir Ana Souza", exact: true }),
  ).toBeVisible();
  await modal.getByRole("button", { name: "Fechar", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Marina Lima" })
    .getByRole("button", { name: "Ver mais" })
    .click();
  await expect(
    modal.getByRole("button", { name: "Editar", exact: true }),
  ).toHaveCount(0);
});

test("promoção sem senha mantém ações alinhadas e explica bloqueio no tooltip", async ({
  page,
}) => {
  const f = await fixture(page, "admin", false, true);
  Object.assign(f.users[1], {
    credential_pending: true,
    cpf: "01234567890",
    auth_user_id: null,
  });
  await page.goto("/usuarios");
  await page
    .getByRole("row")
    .filter({ hasText: "Ana Souza" })
    .getByRole("button", { name: "Ver mais" })
    .click();
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByRole("button", { name: "Tornar administrador", exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Tornar administrador", exact: true }),
  ).toBeDisabled();
  await expect(
    modal.getByText("Gere a senha do usuário antes de torná-lo administrador."),
  ).toBeHidden();
  await modal.locator(".promotion-tooltip").hover();
  await expect(modal.getByRole("tooltip")).toHaveText(
    "Gere a senha do usuário antes de torná-lo administrador.",
  );
  await expect(modal.getByRole("tooltip")).toBeVisible();
  await modal.getByRole("heading").hover();
  await expect(modal.getByRole("tooltip")).toBeHidden();
  await modal.locator(".promotion-tooltip").focus();
  await expect(modal.getByRole("tooltip")).toBeVisible();
  const buttons = modal.locator(".user-details-actions button");
  await expect(buttons).toHaveCount(3);
  const positions = await buttons.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().top),
  );
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(2);
});

test("certificado: configura campos, confere prévia e publica", async ({
  page,
}) => {
  const f = await fixture(page, "admin");
  const source = await readFile("assets/certificado-modelo.pdf");
  const config = {
    hours: "4 horas",
    fields: [
      {
        key: "nome" as const,
        x: 0.1,
        y: 0.45,
        width: 0.8,
        size: 28,
        color: "#152D40",
        align: "center" as const,
      },
    ],
  };
  let saved = false;
  await page.route("**/api/admin/certificates/preview", async (route) => {
    const request = route.request();
    const form = await new Response(new Uint8Array(request.postDataBuffer()!), {
      headers: { "content-type": request.headers()["content-type"] },
    }).formData();
    const selected = JSON.parse(String(form.get("config")));
    await route.fulfill({ contentType: "application/pdf", body: Buffer.from(
      await renderCertificate(source, selected, {
        nome: "Maria Exemplo da Silva", cpf: "00000000000",
        curso: "Introdução à Segurança no Trabalho", carga_horaria: selected.hours,
        data_conclusao: "27/10/2026", codigo_certificado: "00000000-0000-4000-8000-000000000000",
      }),
    ) });
  });
  await page.route("**/api/admin/versions/*/certificate", async (route) => {
    saved = true;
    expect(route.request().postDataBuffer()?.toString()).toContain(
      '"key":"nome"',
    );
    expect(route.request().postDataBuffer()?.toString()).not.toContain('"key":"cpf"');
    expect(route.request().postDataBuffer()?.toString()).not.toContain('filename=');
    await route.fulfill({ json: config });
  });
  await page.goto("/cursos");
  await page.getByRole("button", { name: "Criar curso", exact: true }).click();
  await page.getByLabel("Título do curso").fill("Curso com certificado");
  await page.getByLabel("Apresentação PDF", { exact: true }).setInputFiles({
    name: "curso.pdf",
    mimeType: "application/pdf",
    buffer: f.pdfBytes,
  });
  await page
    .getByRole("checkbox", { name: "Gerar certificado ao concluir?" })
    .check();
  await expect(page.getByRole("dialog", { name: "Prévia do certificado", exact: true })).toHaveCount(0);
  const openPreview = page.getByRole("button", { name: "Abrir prévia do certificado", exact: true });
  const sizes = await openPreview.evaluate((button) => ({ button: button.getBoundingClientRect().width, parent: button.parentElement!.clientWidth }));
  expect(sizes.parent - sizes.button).toBeLessThan(36);
  await openPreview.click();
  await expect(page.locator(".certificate-canvas canvas")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Nome do participante (obrigatório)", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "CPF", exact: true }).uncheck();
  await expect(page.getByRole("button", { name: "Baixar prévia" })).toBeEnabled();
  await expect(page.getByText("Prévia com dados fictícios.", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/certificate-editor.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Voltar ao curso", exact: true })
    .click();
  await page.getByRole("button", { name: "Publicar curso" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(saved).toBe(true);
});

test("certificado: conclusão libera download e histórico preserva emissão", async ({
  page,
}) => {
  const f = await fixture(page);
  f.assignment.version.certificate = {
    path: "example.pdf",
    hours: "4 horas",
    fields: [
      {
        key: "nome",
        x: 0.1,
        y: 0.5,
        width: 0.8,
        size: 24,
        color: "#152D40",
        align: "center",
      },
    ],
  };
  const record = {
    id: "60000000-0000-4000-8000-000000000001",
    assignment_id: f.assignment.id,
    course_title: f.assignment.version.title,
    completed_at: "2026-10-27T12:00:00Z",
  };
  await page.route("**/api/certificates", (route) =>
    route.fulfill({ json: f.assignment.completion ? [record] : [] }),
  );
  await page.route("**/api/certificates/*/pdf", (route) =>
    route.fulfill({ contentType: "application/pdf", body: f.pdfBytes }),
  );
  await page.goto(`/treinamento/${f.assignment.id}`);
  await expect(
    page.getByText("Progresso salvo", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Baixar certificado" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page.getByText("2 de 2 slides visualizados")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar conclusão" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar certificado" }).click();
  expect((await download).suggestedFilename()).toBe("certificado.pdf");
  await page.route("**/api/assignments", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/historico");
  await expect(
    page.getByRole("button", { name: "Baixar certificado" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/certificate-history.png",
    fullPage: true,
  });
});

test("certificado: falha na prévia permite tentar novamente ou desativar", async ({
  page,
}) => {
  const f = await fixture(page, "admin");
  f.courses[0].status = "draft";
  f.courses[0].versions[0].published_at = null;
  f.courses[0].versions[0].certificate = {
    path: "missing.pdf",
    hours: "4 horas",
    fields: [
      {
        key: "nome",
        x: 0.1,
        y: 0.5,
        width: 0.8,
        size: 24,
        color: "#152D40",
        align: "center",
      },
    ],
  };
  await page.route("**/api/admin/certificates/preview", (r) =>
    r.fulfill({
      status: 503,
      json: { error: "Modelo temporariamente indisponível." },
    }),
  );
  await page.route("**/api/admin/versions/*/questions", (r) =>
    r.fulfill({ json: [] }),
  );
  await page.goto("/cursos");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const toggle = page.getByRole("checkbox", {
    name: "Gerar certificado ao concluir?",
  });
  await expect(toggle).toBeEnabled();
  await page
    .getByRole("button", { name: "Abrir prévia do certificado", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Tentar novamente" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Baixar prévia" })).toBeDisabled();
  await page
    .getByRole("button", { name: "Voltar ao curso", exact: true })
    .click();
  await toggle.uncheck();
  await expect(
    page.getByRole("button", { name: "Salvar rascunho" }),
  ).toBeEnabled();
});

test("certificado: abre modal separado e preserva o formulário ao voltar", async ({
  page,
}) => {
  const f = await fixture(page, "admin");
  await page.goto("/cursos");
  await page.getByRole("button", { name: "Criar curso", exact: true }).click();
  await page.getByLabel("Título do curso").fill("Curso preservado");
  await page
    .getByLabel("Descrição", { exact: true })
    .fill("Descrição preservada");
  await page.getByLabel("Apresentação PDF", { exact: true }).setInputFiles({
    name: "curso.pdf",
    mimeType: "application/pdf",
    buffer: f.pdfBytes,
  });
  await page
    .getByRole("checkbox", { name: "Gerar certificado ao concluir?" })
    .check();
  await page.getByRole("button", { name: "Abrir prévia do certificado", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Prévia do certificado", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Prévia do certificado", exact: true })
      .getByRole("button", { name: "Publicar curso" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("dialog", { name: "Prévia do certificado", exact: true })
      .getByRole("button", { name: "Fechar", exact: true }),
  ).toBeFocused();
  await page.getByLabel("Carga horária do curso", { exact: true }).fill("8 horas");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Título do curso")).toHaveValue(
    "Curso preservado",
  );
  await expect(
    page.getByRole("textbox", { name: "Descrição", exact: true }),
  ).toHaveValue("Descrição preservada");
  await expect(
    page.getByLabel("Apresentação PDF", { exact: true }),
  ).toHaveValue(/curso\.pdf$/);
  await expect(page.getByLabel("Carga horária do curso", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Abrir prévia do certificado", exact: true })
    .click();
  await expect(page.getByLabel("Carga horária do curso", { exact: true })).toHaveValue(
    "8 horas",
  );
  await page
    .getByRole("button", { name: "Voltar ao curso", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Gerar certificado ao concluir?" })
    .uncheck();
  await expect(
    page.getByRole("button", { name: "Abrir prévia do certificado", exact: true }),
  ).toHaveCount(0);
  expect(f.getPostCount()).toBe(0);
});
