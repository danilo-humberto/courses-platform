// Disposable local PostgreSQL only. Never reads .env or a remote database URL.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import assert from "node:assert/strict";
const name = `cifra-test-${randomUUID().slice(0, 8)}`;
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
let client;
try {
  docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=synthetic-test-only",
    "-e",
    "POSTGRES_DB=cifra_test",
    "-p",
    "127.0.0.1::5432",
    "postgres:17-alpine",
  );
  const port = docker("port", name, "5432/tcp").trim().split(":").at(-1);
  for (let i = 0; i < 60; i++) {
    try {
      // The initialization server accepts Unix sockets before PostgreSQL restarts.
      // Wait for TCP, which is enabled only by the final server.
      docker("exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  client = new pg.Client({
    host: "127.0.0.1",
    port: Number(port),
    database: "cifra_test",
    user: "postgres",
    password: "synthetic-test-only",
  });
  await client.connect();
  await client.query(readFileSync("supabase/tests/bootstrap.sql", "utf8"));
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await client.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  await client.query(readFileSync("supabase/tests/invariants.sql", "utf8"));
  await client.query(
    readFileSync("supabase/tests/employee_import.sql", "utf8"),
  );
  console.log(
    "PASS: pending employees, optional contact email, duplicates, CPF identity linkage and authorization",
  );
  await client.query(
    readFileSync("supabase/tests/supreme_account.sql", "utf8"),
  );
  console.log(
    "PASS: supreme uniqueness, promotion, RLS, audit and authorization",
  );
  await client.query(readFileSync("supabase/tests/job_positions.sql", "utf8"));
  console.log(
    "PASS: job CRUD, batch atomicity, replacement, deletion, RLS and permissions",
  );
  await client.query(readFileSync("supabase/tests/clear_reports.sql", "utf8"));
  console.log(
    "PASS: global report cleanup, confirmation, authorization, rollback and catalog preservation",
  );
  await client.query(readFileSync("supabase/tests/delete_manager.sql", "utf8"));
  await client.query(
    readFileSync("supabase/tests/delete_manager_auth.sql", "utf8"),
  );
  await client.query(readFileSync("supabase/tests/delete_course.sql", "utf8"));
  await client.query(
    readFileSync("supabase/tests/delete_course_assignments.sql", "utf8"),
  );
  console.log(
    "PASS: migration, RLS, progress, quiz, idempotency, history and inactive users",
  );
  // A fresh assigned quiz for concurrent submissions from the same learner.
  const admin = "10000000-0000-4000-8000-000000000001";
  const manager = "10000000-0000-4000-8000-000000000003";
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin,
  ]);
  const draft = (
    await client.query(
      "select public.admin_save_draft(null,$1::jsonb) as result",
      [
        JSON.stringify({
          title: "Concurrent quiz",
          quiz_enabled: true,
          pass_score: 67,
          max_attempts: 2,
          questions: [1, 2, 3].map((i) => ({
            prompt: `Question ${i}`,
            options: ["Correct", "Wrong"],
            correct_index: 0,
          })),
        }),
      ],
    )
  ).rows[0].result;
  await client.query(
    "select public.set_draft_pdf($1,$2,'test/concurrent.pdf',1)",
    [admin, draft.version_id],
  );
  await client.query("select public.admin_publish($1)", [draft.version_id]);
  await client.query("select public.admin_assign($1,$2::uuid[])", [
    draft.version_id,
    [manager],
  ]);
  const aid = (
    await client.query(
      "select id from public.assignments where version_id=$1",
      [draft.version_id],
    )
  ).rows[0].id;
  const questions = (
    await client.query(
      "select id from public.questions where version_id=$1 order by position",
      [draft.version_id],
    )
  ).rows;
  const twoOfThree = Object.fromEntries(
    questions.map((q, i) => [q.id, i < 2 ? 0 : 1]),
  );
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [
    manager,
  ]);
  await client.query("select public.training_view($1,1)", [aid]);
  async function submit(requestId) {
    const connection = new pg.Client({
      host: "127.0.0.1",
      port: Number(port),
      database: "cifra_test",
      user: "postgres",
      password: "synthetic-test-only",
    });
    await connection.connect();
    try {
      await connection.query("set role authenticated");
      await connection.query(
        "select set_config('request.jwt.claim.sub',$1,false)",
        [manager],
      );
      return (
        await connection.query(
          "select public.training_submit($1,$2,$3::jsonb) as result",
          [aid, requestId, JSON.stringify(twoOfThree)],
        )
      ).rows[0].result;
    } finally {
      await connection.end();
    }
  }
  const requestId = randomUUID();
  const duplicate = await Promise.all([submit(requestId), submit(requestId)]);
  assert.equal(
    duplicate[0].id,
    duplicate[1].id,
    "concurrent retry must return same attempt",
  );
  assert.equal(
    duplicate[0].passed,
    false,
    "2/3 must not round up to passing at 67%",
  );
  const results = await Promise.allSettled([
    submit(randomUUID()),
    submit(randomUUID()),
    submit(randomUUID()),
  ]);
  assert.equal(
    results.filter((r) => r.status === "fulfilled").length,
    1,
    "only one remaining attempt may succeed",
  );
  for (const result of results.filter((r) => r.status === "rejected"))
    assert.match(result.reason.message, /Limite de tentativas atingido/);
  assert.equal(
    (
      await client.query(
        "select count(*)::integer as n from public.quiz_attempts where assignment_id=$1",
        [aid],
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await client.query(
        "select count(*)::integer as n from public.completions where assignment_id=$1",
        [aid],
      )
    ).rows[0].n,
    0,
  );
  console.log(
    "PASS: concurrent idempotency, attempt cap and unrounded 2/3 grading",
  );
  const deleting = new pg.Client({
    host: "127.0.0.1",
    port: Number(port),
    database: "cifra_test",
    user: "postgres",
    password: "synthetic-test-only",
  });
  await deleting.connect();
  try {
    await deleting.query("set role authenticated");
    await deleting.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [admin],
    );
    await deleting.query("set lock_timeout = '200ms'");
    await client.query("begin");
    await client.query("select public.training_start($1)", [aid]);
    await assert.rejects(
      deleting.query("select public.admin_clear_reports('EXCLUIR TUDO')"),
      (error) => error.code === "55P03",
    );
    await assert.rejects(
      deleting.query("select public.admin_delete_course($1,true)", [
        draft.course_id,
      ]),
      (error) => error.code === "55P03",
    );
    await client.query("commit");
    await deleting.query("select public.admin_delete_course($1,true)", [
      draft.course_id,
    ]);
    const remaining = (
      await deleting.query(
        "select (select count(*) from public.assignments where id=$1)::int as assignments, (select count(*) from public.quiz_attempts where assignment_id=$1)::int as attempts, (select count(*) from public.slide_views where assignment_id=$1)::int as views",
        [aid],
      )
    ).rows[0];
    assert.deepEqual(remaining, { assignments: 0, attempts: 0, views: 0 });
    console.log(
      "PASS: deletion waits for in-flight progress and removes dependent records atomically",
    );
  } finally {
    await client.query("rollback");
    await deleting.end();
  }
} finally {
  if (client) await client.end();
  try {
    docker("stop", name);
  } catch {
    /* Container may not have started. */
  }
}
