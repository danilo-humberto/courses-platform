// Run: node --import tsx scripts/test-certificate-flow.mjs
// Disposable PostgreSQL + real Express API and PDF renderer. No .env or remote URL.
// Auth is synthetic; private Storage is in memory. SQL functions and RLS are real.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
import request from "supertest";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createApp } from "../apps/api/src/app.ts";
import { defaultCertificate } from "../apps/api/src/certificate-default.ts";

const container = `cifra-certificate-test-${randomUUID().slice(0, 8)}`;
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
const admin = "10000000-0000-4000-8000-000000000001";
const learner = "10000000-0000-4000-8000-000000000002";
const other = "10000000-0000-4000-8000-000000000003";
const title = "Curso teste isolado - Certificado";
const evidence = "output/certificate-isolated-test";
const checks = [];
const pass = (message) => {
  checks.push(message);
  console.log(`PASS: ${message}`);
};
let pool;
let started = false;
try {
  docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "-e",
    "POSTGRES_PASSWORD=synthetic-test-only",
    "-e",
    "POSTGRES_DB=cifra_certificate_test",
    "-p",
    "127.0.0.1::5432",
    "postgres:17-alpine",
  );
  started = true;
  const port = Number(
    docker("port", container, "5432/tcp").trim().split(":").at(-1),
  );
  for (let i = 0; i < 60; i++) {
    try {
      docker(
        "exec",
        container,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
      );
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  pool = new pg.Pool({
    host: "127.0.0.1",
    port,
    database: "cifra_certificate_test",
    user: "postgres",
    password: "synthetic-test-only",
  });
  const setup = await pool.connect();
  try {
    const destination = (
      await setup.query(
        "select current_database() as db, current_user as role, inet_server_addr()::text as host",
      )
    ).rows[0];
    assert.equal(destination.db, "cifra_certificate_test");
    assert.equal(destination.role, "postgres");
    console.log(
      `Isolated destination: ${container}; localhost:${port}; ${destination.db}; setup role=${destination.role}`,
    );
    await setup.query(readFileSync("supabase/tests/bootstrap.sql", "utf8"));
    for (const file of readdirSync("supabase/migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort())
      await setup.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await setup.query(
      "insert into auth.users(id,email) values ($1,'admin@example.test'),($2,'learner@example.test'),($3,'other@example.test')",
      [admin, learner, other],
    );
    await setup.query(
      "update public.profiles set active=true, name='Participante Teste Isolado'",
    );
    await setup.query("update public.profiles set role='admin' where id=$1", [
      admin,
    ]);
    await setup.query(
      "update public.profiles set cpf='00000000000' where id=$1",
      [learner],
    );
  } finally {
    setup.release();
  }
  async function query(actor, role, sql, params = []) {
    assert.ok(["authenticated", "service_role"].includes(role));
    const connection = await pool.connect();
    try {
      await connection.query("begin");
      await connection.query(`set local role ${role}`);
      await connection.query(
        "select set_config('request.jwt.claim.sub',$1,true)",
        [actor],
      );
      const result = await connection.query(sql, params);
      await connection.query("commit");
      return { data: result.rows, error: null };
    } catch (error) {
      await connection.query("rollback");
      return {
        data: null,
        error: { message: error.message, code: error.code },
      };
    } finally {
      connection.release();
    }
  }
  const rpcNames = new Set([
    "admin_save_draft",
    "set_draft_pdf",
    "set_draft_certificate",
    "admin_publish",
    "admin_assign",
    "training_start",
    "training_view",
    "training_complete",
    "admin_delete_course",
  ]);
  function client(actor, role = "authenticated") {
    return {
      async rpc(name, params) {
        assert.ok(rpcNames.has(name));
        const keys = Object.keys(params);
        assert.ok(keys.every((key) => /^p_[a-z_]+$/.test(key)));
        const result = await query(
          actor,
          role,
          `select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(",")}) as result`,
          Object.values(params),
        );
        return { data: result.data?.[0]?.result, error: result.error };
      },
      from(table) {
        assert.ok(["course_versions", "certificates"].includes(table));
        let recordId;
        const builder = {
          select() {
            return builder;
          },
          eq(column, value) {
            assert.equal(column, "id");
            recordId = value;
            return builder;
          },
          order() {
            return builder;
          },
          range(start, end) {
            return query(
              actor,
              role,
              `select * from public.${table} order by completed_at desc, id limit $1 offset $2`,
              [end - start + 1, start],
            );
          },
          async maybeSingle() {
            const result = await query(
              actor,
              role,
              `select * from public.${table} where id=$1`,
              [recordId],
            );
            return { data: result.data?.[0] ?? null, error: result.error };
          },
        };
        return builder;
      },
    };
  }
  const files = new Map();
  const service = {
    ...client(admin, "service_role"),
    storage: {
      from(bucket) {
        return {
          async download(path) {
            const bytes = files.get(`${bucket}/${path}`);
            return {
              data: bytes ? new Blob([bytes]) : null,
              error: bytes ? null : { message: "missing" },
            };
          },
          async upload(path, bytes) {
            const key = `${bucket}/${path}`;
            if (files.has(key))
              return { data: null, error: { message: "exists" } };
            files.set(key, Buffer.from(bytes));
            return { data: { path }, error: null };
          },
          async remove(paths) {
            for (const path of paths) files.delete(`${bucket}/${path}`);
            return { data: null, error: null };
          },
        };
      },
    },
  };
  const app = createApp(
    {
      url: "http://127.0.0.1:1",
      publishableKey: "synthetic",
      secretKey: "synthetic",
      origin: "http://localhost",
    },
    {
      service,
      authenticate: async (token) => {
        assert.ok([admin, learner, other].includes(token));
        const profile = (
          await pool.query("select * from public.profiles where id=$1", [token])
        ).rows[0];
        return { profile, db: client(token) };
      },
    },
  );
  const http = (actor, method, path) =>
    request(app)[method](path).auth(actor, { type: "bearer" });
  const created = await http(admin, "post", "/api/admin/courses")
    .send({
      title,
      description: "Dados sintéticos; ambiente descartável",
      quiz_enabled: false,
      pass_score: 70,
      max_attempts: 2,
      questions: [],
    })
    .expect(201);
  const { version_id: version, course_id: course } = created.body;
  const slides = await PDFDocument.create();
  for (const text of ["Curso teste isolado", "Fim do curso teste"])
    slides.addPage([800, 450]).drawText(text, { x: 50, y: 300 });
  await http(admin, "post", `/api/admin/versions/${version}/pdf`)
    .attach("pdf", Buffer.from(await slides.save()), "curso-teste.pdf")
    .expect(200);
  const config = {
    ...defaultCertificate,
    fields: defaultCertificate.fields.filter((field) => field.key !== "cpf"),
  };
  await http(admin, "put", `/api/admin/versions/${version}/certificate`)
    .field("enabled", "true")
    .field("config", JSON.stringify(config))
    .expect(200);
  await http(admin, "post", `/api/admin/versions/${version}/publish`).expect(
    204,
  );
  const assigned = await client(admin).rpc("admin_assign", {
    p_version: version,
    p_managers: [learner],
  });
  assert.equal(assigned.error, null, JSON.stringify(assigned.error));
  const assignment = (
    await pool.query("select id from public.assignments where version_id=$1", [
      version,
    ])
  ).rows[0].id;
  pass(
    "Curso criado, modelo padrão configurado sem CPF, publicado e atribuído ao participante",
  );
  assert.deepEqual(
    (await http(learner, "get", "/api/certificates").expect(200)).body,
    [],
  );
  await http(learner, "post", `/api/assignments/${assignment}/complete`).expect(
    400,
  );
  await http(learner, "post", `/api/assignments/${assignment}/views`)
    .send({ page: 1 })
    .expect(204);
  await http(learner, "post", `/api/assignments/${assignment}/views`)
    .send({ page: 2 })
    .expect(204);
  await http(learner, "post", `/api/assignments/${assignment}/complete`).expect(
    204,
  );
  await http(learner, "post", `/api/assignments/${assignment}/complete`).expect(
    204,
  );
  const history = (await http(learner, "get", "/api/certificates").expect(200))
    .body;
  assert.equal(history.length, 1);
  assert.equal(history[0].course_title, title);
  pass(
    "Conclusão bloqueada antes dos slides; após conclusão, histórico contém exatamente um certificado",
  );
  const certificate = history[0].id;
  const downloaded = await http(
    learner,
    "get",
    `/api/certificates/${certificate}/pdf`,
  )
    .expect(200)
    .expect("Content-Type", /application\/pdf/);
  const task = getDocument({ data: new Uint8Array(downloaded.body) });
  const pdf = await task.promise;
  assert.equal(pdf.numPages, 1);
  const text = (await (await pdf.getPage(1)).getTextContent()).items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  assert.ok(text.includes("Participante Teste Isolado"));
  assert.ok(text.includes(title));
  assert.ok(text.includes("Carga horária: 4 horas"));
  assert.ok(text.includes("Conclusão:"));
  assert.ok(text.includes(certificate));
  assert.ok(!text.includes("CPF:"));
  assert.ok(!text.includes("SEM VALIDADE"));
  await task.destroy();
  mkdirSync(evidence, { recursive: true });
  writeFileSync(`${evidence}/certificado-recebido.pdf`, downloaded.body);
  pass(
    "Participante recebeu pela API um PDF válido com seu nome, curso, data e código; CPF desmarcado ausente",
  );
  await http(other, "get", `/api/certificates/${certificate}/pdf`).expect(404);
  assert.deepEqual(
    (await http(other, "get", "/api/certificates").expect(200)).body,
    [],
  );
  pass("RLS real impede outro participante de listar ou baixar o certificado");
  await pool.query(
    "update public.profiles set name='Nome alterado após conclusão' where id=$1",
    [learner],
  );
  await http(admin, "delete", `/api/admin/courses/${course}`)
    .send({ delete_assignments: true })
    .expect(204);
  assert.equal(
    (await http(learner, "get", "/api/certificates").expect(200)).body.length,
    1,
  );
  const again = await http(
    learner,
    "get",
    `/api/certificates/${certificate}/pdf`,
  ).expect(200);
  assert.deepEqual(again.body, downloaded.body);
  pass(
    "Excluir curso e alterar nome preservam histórico e PDF original, byte a byte",
  );
  await pool.query("update public.profiles set active=false where id=$1", [
    learner,
  ]);
  await http(learner, "get", `/api/certificates/${certificate}/pdf`).expect(
    403,
  );
  pass("Participante desativado não consegue baixar");
  writeFileSync(
    `${evidence}/resultado.json`,
    JSON.stringify(
      {
        checks,
        course,
        assignment,
        certificate,
        isolation:
          "PostgreSQL Docker descartável; API real; Auth sintética; Storage em memória; sem .env nem Supabase remoto",
      },
      null,
      2,
    ),
  );
} finally {
  if (pool) await pool.end();
  if (started) {
    docker("stop", container);
    const remaining = docker(
      "ps",
      "-a",
      "--filter",
      `name=^/${container}$`,
      "--format",
      "{{.Names}}",
    ).trim();
    assert.equal(remaining, "");
    console.log(
      "CLEANUP: contêiner removido; nenhum registro persistido no Supabase atual",
    );
  }
}
