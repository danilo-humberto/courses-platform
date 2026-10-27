import { useErrorState, useToast } from "./components/Toast";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  Plus,
  Search,
  Users,
  Layers,
  Trash2,
  X,
} from "lucide-react";
import { api, exportCsv } from "./lib";
import {
  type Assignment,
  type Course,
  type Profile,
  date,
  statusNames,
} from "./types";
import {
  Badge,
  Empty,
  ErrorNotice,
  Loading,
  Progress,
} from "./components/shared";
import { Button } from "./components/ui/button";

export function Dashboard({ admin, name }: { admin: boolean; name: string }) {
  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [error, setError] = useErrorState();
  useEffect(() => {
    void Promise.all([
      api<Assignment[]>("/assignments"),
      api<Course[]>("/courses"),
      admin ? api<Profile[]>("/admin/users") : Promise.resolve([]),
    ])
      .then(([a, c, u]) => {
        setRows(a);
        setCourses(c);
        setUsers(u.filter((profile) => !profile.deleted_at));
      })
      .catch((e) => setError(e.message));
  }, [admin]);
  if (error) return <ErrorNotice message={error} />;
  if (!rows) return <Loading />;
  const done = rows.filter((a) => a.status === "completed").length;
  const ongoing = rows.filter((a) => a.status === "in_progress").length;
  const pending = rows.length - done - ongoing;
  const rate = rows.length ? Math.round((done / rows.length) * 100) : 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {admin ? "ACOMPANHAMENTO E GESTÃO" : "SEU DESENVOLVIMENTO"}
          </span>
          <h1>
            {admin
              ? "Visão geral"
              : `Olá, ${name.split(" ")[0] || "colaborador"}.`}
          </h1>
          <p>
            {admin
              ? "Uma visão clara do aprendizado de toda a equipe."
              : "Todo grande avanço começa com um novo aprendizado."}
          </p>
        </div>
        {admin && (
          <Button asChild>
            <Link to="/cursos">
              <Plus size={17} /> Criar curso
            </Link>
          </Button>
        )}
      </div>
      <section className="welcome-banner">
        <div>
          <span className="banner-label">
            <span /> APRENDIZADO EM MOVIMENTO
          </span>
          <h2>
            {admin
              ? "Desenvolva pessoas.\nTransforme resultados."
              : "Seu próximo passo\ncomeça aqui."}
          </h2>
          <p>
            {admin
              ? "Acompanhe a evolução da equipe e mantenha\no conhecimento sempre em dia."
              : "Explore seus treinamentos e continue\nde onde você parou."}
          </p>
          <Link to={admin ? "/relatorios" : "/meus-cursos"}>
            {admin ? "Acompanhar treinamentos" : "Explorar meus treinamentos"}
            <ArrowRight size={17} />
          </Link>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="book-graphic">
            <BookOpen size={72} strokeWidth={1.2} />
          </div>
          <span className="art-chip chip-one">
            <CheckCircle2 size={17} /> Novas possibilidades
          </span>
          <span className="art-chip chip-two">
            <Layers size={17} /> Conhecimento que conecta
          </span>
          <span className="art-spark">✦</span>
        </div>
      </section>
      <div className="stats-grid">
        {(admin
          ? [
              {
                title: "Usuários cadastrados",
                value: users.filter((u) => u.role === "manager").length,
                hint: `${users.filter((u) => u.role === "manager" && u.active).length} com acesso ativo`,
                icon: Users,
              },
              {
                title: "Cursos publicados",
                value: courses.filter((c) => c.status === "published").length,
                hint: "Disponíveis para atribuição",
                icon: BookOpen,
              },
              {
                title: "Em andamento",
                value: ongoing,
                hint: `${pending} ainda não iniciados`,
                icon: Clock3,
              },
              {
                title: "Treinamentos concluídos",
                value: done,
                hint: `${rate}% das atribuições`,
                icon: CheckCircle2,
              },
            ]
          : [
              {
                title: "Meus treinamentos",
                value: rows.length,
                hint: "Atribuídos a você",
                icon: BookOpen,
              },
              {
                title: "Não iniciados",
                value: pending,
                hint: "Seu próximo aprendizado",
                icon: Layers,
              },
              {
                title: "Em andamento",
                value: ongoing,
                hint: "Continue de onde parou",
                icon: Clock3,
              },
              {
                title: "Concluídos",
                value: done,
                hint: "Conhecimento para levar adiante",
                icon: CheckCircle2,
              },
            ]
        ).map((s) => (
          <article className="stat-card" key={s.title}>
            <div>
              <span>{s.title}</span>
              <s.icon size={19} />
            </div>
            <strong>{s.value.toString().padStart(2, "0")}</strong>
            <small>{s.hint}</small>
          </article>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{admin ? "Conclusão por curso" : "Continue aprendendo"}</h2>
              <p>
                {admin
                  ? "Evolução das atribuições em todas as versões"
                  : "Seus treinamentos ainda em aberto"}
              </p>
            </div>
            <Link className="text-link" to={admin ? "/cursos" : "/meus-cursos"}>
              Ver todos <ArrowUpRight size={15} />
            </Link>
          </div>
          {admin
            ? courses
                .filter((c) => c.versions.some((v) => v.published_at))
                .slice(0, 5)
                .map((c) => {
                  const v = [...c.versions]
                    .sort((a, b) => b.version - a.version)
                    .find((v) => v.published_at)!;
                  const assigned = rows.filter(
                    (a) => a.version.course_id === c.id,
                  );
                  const completed = assigned.filter(
                    (a) => a.status === "completed",
                  ).length;
                  return (
                    <div className="course-progress" key={c.id}>
                      <span className="course-icon">
                        <BookOpen size={20} />
                      </span>
                      <div>
                        <strong>{v?.title}</strong>
                        <small>
                          {completed} de {assigned.length} treinamentos
                          concluídos
                        </small>
                        <Progress
                          value={
                            assigned.length
                              ? Math.round((completed / assigned.length) * 100)
                              : 0
                          }
                        />
                      </div>
                    </div>
                  );
                })
            : rows
                .filter((a) => a.status !== "completed")
                .slice(0, 4)
                .map((a) => (
                  <Link
                    className="course-progress"
                    key={a.id}
                    to={`/treinamento/${a.id}`}
                  >
                    <span className="course-icon">
                      <BookOpen size={20} />
                    </span>
                    <div>
                      <strong>{a.version.title}</strong>
                      <small>
                        {a.views.length} de {a.version.page_count} slides
                      </small>
                      <Progress value={a.progress} />
                    </div>
                    <ArrowRight size={18} />
                  </Link>
                ))}
          {(admin
            ? !courses.some((c) => c.versions.some((v) => v.published_at))
            : !rows.some((a) => a.status !== "completed")) && (
            <Empty
              title={
                admin ? "O aprendizado começa aqui" : "Tudo em dia por aqui"
              }
            >
              {admin
                ? "Publique um curso e atribua aos usuários para acompanhar a evolução."
                : "Novos treinamentos aparecerão quando forem atribuídos a você."}
            </Empty>
          )}
        </section>
        <section className="panel distribution">
          <div className="panel-heading">
            <div>
              <h2>Panorama dos treinamentos</h2>
              <p>{rows.length} atribuições no total</p>
            </div>
          </div>
          <div
            className="donut"
            style={{
              background: `conic-gradient(#235c45 0 ${rate}%, #c0d57b ${rate}% ${rows.length ? ((done + ongoing) / rows.length) * 100 : 0}%, #edf0e9 0)`,
            }}
          >
            <div>
              <strong>{rate}%</strong>
              <span>concluídos</span>
            </div>
          </div>
          <div className="legend">
            <span>
              <i className="dot done" />
              Concluídos <strong>{done}</strong>
            </span>
            <span>
              <i className="dot ongoing" />
              Em andamento <strong>{ongoing}</strong>
            </span>
            <span>
              <i className="dot pending" />
              Não iniciados <strong>{pending}</strong>
            </span>
          </div>
        </section>
      </div>
      <div className="tip">
        <Check size={17} />
        <span>
          {admin
            ? "O histórico de conclusões é preservado, mesmo quando o conteúdo dos cursos é atualizado."
            : "Seu progresso é salvo automaticamente após a visualização de cada slide."}
        </span>
      </div>
    </>
  );
}

export function MyCourses({ history = false }: { history?: boolean }) {
  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useErrorState();
  useEffect(() => {
    void api<Assignment[]>("/assignments")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  const visible = rows?.filter(
    (a) =>
      (!history || a.status === "completed") &&
      (!filter || a.status === filter) &&
      a.version.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SUA JORNADA</span>
          <h1>{history ? "Meu histórico" : "Meus treinamentos"}</h1>
          <p>
            {history
              ? "Cada conclusão é mais um passo no seu desenvolvimento."
              : "Aprenda no seu ritmo. Seu progresso fica salvo."}
          </p>
        </div>
      </div>
      <ErrorNotice message={error} />
      <div className="filters">
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Buscar treinamento"
            placeholder="Buscar treinamento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {!history && (
          <select
            aria-label="Situação"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">Todas as situações</option>
            {Object.entries(statusNames).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        )}
      </div>
      {!rows && !error ? (
        <Loading />
      ) : (
        <div className="course-grid">
          {visible?.map((a, i) => (
            <article className="training-card" key={a.id}>
              <div className={`training-cover cover-${i % 3}`}>
                <BookOpen size={42} strokeWidth={1.3} />
                <span>
                  VERSÃO {a.version.version.toString().padStart(2, "0")}
                </span>
              </div>
              <div className="training-content">
                <Badge status={a.status} />
                <h2>{a.version.title}</h2>
                <p>
                  {a.version.description ||
                    "Um novo conhecimento para o seu dia a dia."}
                </p>
                <div className="metadata">
                  <span>{a.version.page_count} slides</span>
                  <span>
                    {a.version.quiz_enabled
                      ? "Com questionário"
                      : "Sem questionário"}
                  </span>
                </div>
                <Progress value={a.progress} />
                {a.completion && (
                  <small className="completion-date">
                    Concluído em {date(a.completion.completed_at)}
                  </small>
                )}
                <Button variant="outline" className="w-full" asChild>
                  <Link to={`/treinamento/${a.id}`}>
                    {a.status === "completed"
                      ? "Revisar treinamento"
                      : a.status === "in_progress"
                        ? "Continuar treinamento"
                        : "Começar treinamento"}
                    <ArrowRight size={16} />
                  </Link>
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {visible?.length === 0 && (
        <Empty title="Nenhum treinamento encontrado">
          Tente outro filtro ou aguarde uma nova atribuição.
        </Empty>
      )}
    </>
  );
}

export function Reports() {
  const confirmation = useRef<HTMLDialogElement>(null);
  const notify = useToast();
  const [clearing, setClearing] = useState(false);
  const [rows, setRows] = useState<Assignment[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [manager, setManager] = useState("");
  const [course, setCourse] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useErrorState();
  const [busy, setBusy] = useState(true);
  async function clearReports() {
    if (busy || clearing) return;
    setClearing(true);
    setError("");
    try {
      await api("/admin/reports", "DELETE", { confirmation: "EXCLUIR TUDO" });
      setRows([]);
      confirmation.current?.close();
      notify("Todos os dados dos relatórios foram excluídos.");
    } catch (e) {
      confirmation.current?.close();
      notify((e as Error).message, "error");
    } finally {
      setClearing(false);
    }
  }
  const query = new URLSearchParams({
    ...(manager && { manager }),
    ...(course && { course }),
    ...(status && { status }),
  }).toString();
  useEffect(() => {
    void Promise.all([
      api<Profile[]>("/admin/users"),
      api<Course[]>("/courses"),
    ])
      .then(([u, c]) => {
        setUsers(u);
        setCourses(c);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let active = true;
    setBusy(true);
    void api<Assignment[]>(`/admin/reports?${query}`)
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [query]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DADOS E AUDITORIA</span>
          <h1>Relatórios</h1>
          <p>
            Consulte o progresso, identifique pendências e acompanhe os
            resultados.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || clearing}
            onClick={() =>
              void exportCsv(query).catch((e) => setError(e.message))
            }
          >
            <Download size={17} /> Exportar CSV
          </Button>
          <Button
            variant="destructive"
            disabled={busy || clearing}
            onClick={() => {
              setError("");
              confirmation.current?.showModal();
            }}
          >
            <Trash2 size={17} /> {clearing ? "Limpando..." : "Limpar dados"}
          </Button>
        </div>
      </div>
      <ErrorNotice message={error} />
      <div className="filters">
        <select
          aria-label="Usuário"
          disabled={clearing}
          value={manager}
          onChange={(e) => setManager(e.target.value)}
        >
          <option value="">Todos os usuários</option>
          {users
            .filter((u) => u.role === "manager" && !u.deleted_at)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email}
              </option>
            ))}
        </select>
        <select
          aria-label="Curso"
          disabled={clearing}
          value={course}
          onChange={(e) => setCourse(e.target.value)}
        >
          <option value="">Todos os cursos</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {[...c.versions].sort((a, b) => b.version - a.version)[0]?.title}
            </option>
          ))}
        </select>
        <select
          aria-label="Situação"
          disabled={clearing}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todas as situações</option>
          {Object.entries(statusNames).map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>
            Treinamentos atribuídos <span className="count">{rows.length}</span>
          </h2>
          <small>Datas no seu fuso local</small>
        </div>
        {busy ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Usuário / Curso</th>
                  <th>Situação</th>
                  <th>Progresso</th>
                  <th>Início / Conclusão</th>
                  <th>Questionário</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.manager.name}</strong>
                      <small>{a.manager.email}</small>
                      <span>
                        {a.version.title} · v{a.version.version}
                      </span>
                    </td>
                    <td>
                      <Badge status={a.status} />
                    </td>
                    <td>
                      <Progress value={a.progress} />
                    </td>
                    <td>
                      <small>{date(a.started_at)}</small>
                      <small>{date(a.completion?.completed_at)}</small>
                    </td>
                    <td>
                      {a.version.quiz_enabled ? (
                        a.attempts.length ? (
                          <details>
                            <summary>{a.attempts.length} tentativa(s)</summary>
                            {[...a.attempts]
                              .sort((x, y) => x.attempt - y.attempt)
                              .map((t) => (
                                <small key={t.id}>
                                  #{t.attempt}: {Number(t.score).toFixed(1)}% ·{" "}
                                  {t.passed ? "Aprovado" : "Reprovado"}
                                  <br />
                                  {date(t.submitted_at)}
                                </small>
                              ))}
                          </details>
                        ) : (
                          "Sem tentativas"
                        )
                      ) : (
                        "Não se aplica"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <Empty title="Nenhum resultado">
                Ajuste os filtros para consultar outros treinamentos.
              </Empty>
            )}
          </div>
        )}
      </section>
      <dialog
        ref={confirmation}
        className="modal"
        aria-labelledby="clear-reports-title"
        aria-describedby="clear-reports-description"
        onCancel={(event) => {
          if (clearing) event.preventDefault();
        }}
      >
        <div className="modal-heading">
          <h2 id="clear-reports-title">Limpar todos os dados?</h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Fechar"
            disabled={clearing}
            onClick={() => confirmation.current?.close()}
          >
            <X size={20} />
          </Button>
        </div>
        <div id="clear-reports-description">
          <p>
            Todos os dados dos relatórios serão excluídos, independentemente dos
            filtros.
          </p>
          <p>
            Atribuições, progressos, respostas, tentativas e conclusões serão
            apagados definitivamente, inclusive do histórico dos usuários.
            Cursos, contas e registros de auditoria serão preservados.
          </p>
          <p>
            <strong>Esta ação não pode ser desfeita.</strong>
          </p>
        </div>
        <div className="form-actions">
          <Button
            variant="outline"
            autoFocus
            disabled={clearing}
            onClick={() => confirmation.current?.close()}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={busy || clearing}
            onClick={() => void clearReports()}
          >
            {clearing ? "Limpando..." : "Excluir tudo"}
          </Button>
        </div>
      </dialog>
    </>
  );
}
