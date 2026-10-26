import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Assignment, Course, Profile } from "../../apps/web/src/types";
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
async function fixture(
  page: Page,
  role: "admin" | "manager" = "manager",
  quiz = false,
) {
  const profile = role === "admin" ? admin : manager;
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
  await page.route("**/api/**", async (route) => {
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
    if (path === "/admin/users" && method === "GET") return ok(users);
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
          body: "Gerente,Curso\nAna,Cultura",
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
  await page.goto("/gerentes");
  await expect(page.getByText("Exclusão pendente")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Editar", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: `Excluir ${manager.name}` }).click();
  await expect(
    page.getByText(/A conta de login será apagada do Supabase Auth/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(
    page.getByText(
      "Gerente excluído. O e-mail foi liberado e o histórico preservado.",
    ),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("Nenhum gerente encontrado")).toBeVisible();
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
    page.getByRole("table", { name: "Treinamentos por gerente" }),
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
  await page.goto("/gerentes");
  await page.getByRole("button", { name: "Excluir Ana Souza" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "histórico de treinamentos será preservado",
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Excluir Ana Souza" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Excluir Ana Souza" }).click();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Gerente excluído. O e-mail foi liberado e o histórico preservado.",
  );
  await page.getByRole("button", { name: "Fechar notificação" }).click();
  await expect(
    page.getByText(
      "Gerente excluído. O e-mail foi liberado e o histórico preservado.",
    ),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Nenhum gerente encontrado")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Nenhum gerente encontrado")).toBeVisible();
  await page.goto("/relatorios");
  await expect(page.getByRole("table")).toContainText("Ana Souza");
});

test("falha na exclusão mantém gerente e permite tentar novamente", async ({
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
  await page.goto("/gerentes");
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
      "Gerente excluído. O e-mail foi liberado e o histórico preservado.",
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
    page.getByRole("button", { name: "Excluir Ana Souza" }),
  ).toBeVisible();
});

test("cadastro e desativação de gerente", async ({ page }) => {
  await fixture(page, "admin");
  await page.goto("/gerentes");
  await page.getByRole("button", { name: "Cadastrar gerente" }).click();
  await page.getByLabel("Nome completo").fill("Carlos Teste");
  await page.getByLabel("E-mail corporativo").fill("carlos@example.test");
  await page.getByLabel("Senha inicial").fill("synthetic-password-123");
  await page.getByRole("button", { name: "Salvar gerente" }).click();
  await expect(page.getByText("Carlos Teste", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Gerente cadastrado com sucesso.",
  );
  await page
    .getByRole("row")
    .filter({ hasText: "Carlos Teste" })
    .getByRole("button", { name: "Editar" })
    .click();
  await page.getByLabel("Acesso ativo").uncheck();
  await page.getByRole("button", { name: "Salvar gerente" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Gerente atualizado com sucesso.",
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
test("gerente tem navegação própria e layout móvel sem overflow", async ({
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
    page.getByRole("link", { name: "Gerentes", exact: true }),
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
  await page.goto("/gerentes");
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
      json: { error: "Não foi possível carregar os gerentes." },
    }),
  );
  await page.goto("/gerentes");
  await expect(page.getByRole("alert")).toContainText(
    "Não foi possível carregar os gerentes.",
  );
  await expect(page.locator(".toast-error")).toBeVisible();
  await page.getByRole("button", { name: "Fechar notificação" }).click();
  await expect(page.locator(".system-toast")).toHaveCount(0);
  await expect(page.locator(".error")).toContainText(
    "Não foi possível carregar os gerentes.",
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
  await page.getByLabel("E-mail corporativo").fill("unknown@example.test");
  await page.getByRole("button", { name: "Enviar instruções" }).click();
  await expect(page.getByText(/Se o e-mail estiver cadastrado/)).toBeVisible();
});

test("filtro de relatórios não lista gerentes excluídos", async ({ page }) => {
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
  const filter = page.getByRole("combobox", { name: "Gerente", exact: true });
  await expect(
    page.getByRole("button", { name: "Limpar dados" }),
  ).toBeEnabled();
  await expect(filter.locator("option")).toHaveText(["Todos os gerentes"]);
  profiles = [admin, { ...manager, active: false }];
  await page.reload();
  await expect(filter.locator("option")).toHaveText([
    "Todos os gerentes",
    manager.name,
  ]);
});
