import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  BookOpen,
  FileUp,
  Plus,
  Search,
  X,
  Pencil,
  Users,
  Archive,
  Trash2,
  Check,
} from "lucide-react";
import { api } from "./lib";
import { useToast, useErrorState } from "./components/Toast";
import {
  type Course,
  type Profile,
  type Question,
  type Version,
} from "./types";
import { Button } from "./components/ui/button";
import { Empty, ErrorNotice, Loading } from "./components/shared";

function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(event) => {
        // O cancel do seletor de arquivos também propaga até o dialog.
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        close();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <Button variant="ghost" size="icon" aria-label="Fechar" onClick={close}>
          <X size={20} />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
export function UsersPage() {
  const notify = useToast();
  const [users, setUsers] = useState<Profile[] | null>(null);
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Profile | "new" | null>(null);
  const [removing, setRemoving] = useState<Profile | null>(null);
  const [error, setError] = useErrorState();
  const [busy, setBusy] = useState(false);
  const reload = () => api<Profile[]>("/admin/users").then(setUsers);
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    try {
      if (edit === "new")
        await api("/admin/users", "POST", {
          name: f.get("name"),
          email: f.get("email"),
          password: f.get("password"),
        });
      else if (edit)
        await api(`/admin/users/${edit.id}`, "PATCH", {
          name: f.get("name"),
          active: f.get("active") === "on",
        });
      await reload();
      setEdit(null);
      notify(
        edit === "new"
          ? "Gerente cadastrado com sucesso."
          : "Gerente atualizado com sucesso.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!removing || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/users/${removing.id}`, "DELETE");
      setUsers(
        (current) => current?.filter((u) => u.id !== removing.id) ?? null,
      );
      setRemoving(null);
      notify(
        "Gerente excluído. O e-mail foi liberado e o histórico preservado.",
      );
    } catch (e) {
      setError((e as Error).message);
      // Auth may fail after the profile has already been disabled. Preserve the original error.
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  const visible = users?.filter(
    (u) =>
      u.role === "manager" &&
      (!u.deleted_at || Boolean(u.auth_user_id)) &&
      `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PESSOAS QUE EVOLUEM</span>
          <h1>Gerentes</h1>
          <p>Gerencie participantes e controle o acesso à plataforma.</p>
        </div>
        <Button
          onClick={() => {
            setError("");
            setEdit("new");
          }}
        >
          <Plus size={17} /> Cadastrar gerente
        </Button>
      </div>
      {!edit && !removing && <ErrorNotice message={error} />}
      <div className="filters">
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Buscar gerente"
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <section className="panel">
        {!users ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Participante</th>
                  <th>E-mail</th>
                  <th>Acesso</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible?.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name || "Cadastro pendente"}</strong>
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span
                        className={`badge ${u.active ? "completed" : "not_started"}`}
                      >
                        <i />
                        {u.deleted_at
                          ? "Exclusão pendente"
                          : u.active
                            ? "Ativo"
                            : "Desativado"}
                      </span>
                    </td>
                    <td>
                      {!u.deleted_at && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setError("");
                            setEdit(u);
                          }}
                        >
                          <Pencil size={15} /> Editar
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Excluir ${u.name || u.email}`}
                        className="hover:text-red-400"
                        onClick={() => {
                          setError("");
                          setRemoving(u);
                        }}
                      >
                        <Trash2 size={15} />{" "}
                        {u.deleted_at ? "Concluir exclusão" : "Excluir"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible?.length && (
              <Empty title="Nenhum gerente encontrado">
                Cadastre o primeiro participante ou ajuste a busca.
              </Empty>
            )}
          </div>
        )}
      </section>
      {removing && (
        <Modal
          title="Excluir gerente"
          close={() => {
            if (!busy) setRemoving(null);
          }}
        >
          <p>
            Excluir <strong>{removing.name || removing.email}</strong>?
          </p>
          <p>
            A conta de login será apagada do Supabase Auth, liberando o e-mail
            para um novo cadastro. O gerente perderá o acesso. Seu histórico de
            treinamentos será preservado nos relatórios; um novo cadastro com o
            mesmo e-mail não herdará esse histórico.
          </p>
          <ErrorNotice message={error} />
          <div className="form-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? "Excluindo..." : "Confirmar exclusão"}
            </Button>
          </div>
        </Modal>
      )}
      {edit && (
        <Modal
          title={edit === "new" ? "Cadastrar gerente" : "Editar gerente"}
          close={() => {
            if (!busy) setEdit(null);
          }}
        >
          <form onSubmit={save}>
            <label>
              Nome completo
              <input
                name="name"
                autoFocus
                required
                maxLength={120}
                defaultValue={edit === "new" ? "" : edit.name}
              />
            </label>
            {edit === "new" ? (
              <>
                <label>
                  E-mail corporativo
                  <input name="email" type="email" required />
                </label>
                <label>
                  Senha inicial
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                  <small>
                    Use pelo menos 12 caracteres e entregue por um canal seguro.
                    O gerente pode redefini-la na tela de acesso.
                  </small>
                </label>
              </>
            ) : (
              <>
                <label>
                  E-mail
                  <input value={edit.email} disabled />
                </label>
                <label className="check-label">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={edit.active}
                  />{" "}
                  Acesso ativo
                </label>
                <p className="muted">
                  Desativar bloqueia o acesso e preserva o histórico de
                  treinamentos.
                </p>
              </>
            )}
            <ErrorNotice message={error} />
            <div className="form-actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setEdit(null)}
              >
                Cancelar
              </Button>
              <Button disabled={busy}>
                {busy ? "Salvando..." : "Salvar gerente"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function Courses() {
  const notify = useToast();
  const [removing, setRemoving] = useState<Course | null>(null);
  const [deleteAssignments, setDeleteAssignments] = useState(false);
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useErrorState();
  const [editor, setEditor] = useState<{
    course?: Course;
    version?: Version;
  } | null>(null);
  const [assign, setAssign] = useState<Version | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const reload = () => api<Course[]>("/courses").then(setCourses);
  useEffect(() => {
    void Promise.all([
      reload(),
      api<Profile[]>("/admin/users").then(setUsers),
    ]).catch((e) => setError(e.message));
  }, []);
  async function archive(c: Course) {
    if (
      !window.confirm(
        "Arquivar este curso? Novas atribuições serão bloqueadas. O histórico e as atribuições existentes permanecem disponíveis.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/courses/${c.id}/archive`, "POST");
      await reload();
      notify("Curso arquivado. O histórico foi preservado.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!removing || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/courses/${removing.id}`, "DELETE", {
        delete_assignments: deleteAssignments,
      });
      setCourses(
        (current) => current?.filter((c) => c.id !== removing.id) ?? null,
      );
      setRemoving(null);
      notify("Curso excluído com sucesso.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function assignManagers() {
    setBusy(true);
    setError("");
    try {
      await api(`/admin/versions/${assign!.id}/assign`, "POST", {
        managers: selected,
      });
      setAssign(null);
      notify("Treinamento atribuído com sucesso.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const visible = courses?.filter(
    (c) =>
      (!filter || c.status === filter) &&
      c.versions.some((v) =>
        v.title.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONHECIMENTO COMPARTILHADO</span>
          <h1>Cursos</h1>
          <p>Crie experiências de aprendizado e desenvolva sua equipe.</p>
        </div>
        <Button onClick={() => setEditor({})}>
          <Plus size={17} /> Criar curso
        </Button>
      </div>
      {!assign && !removing && <ErrorNotice message={error} />}
      <div className="filters">
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Buscar curso"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar curso..."
          />
        </label>
        <select
          aria-label="Status do curso"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">Todos os status</option>
          <option value="draft">Rascunho</option>
          <option value="published">Publicado</option>
          <option value="archived">Arquivado</option>
        </select>
      </div>
      {!courses ? (
        <Loading />
      ) : (
        <div className="course-grid">
          {visible?.map((c, i) => {
            const versions = [...c.versions].sort(
              (a, b) => b.version - a.version,
            );
            const v = versions[0];
            const published = versions.find((v) => v.published_at);
            return (
              <article className="training-card" key={c.id}>
                <div className={`training-cover cover-${i % 3}`}>
                  <BookOpen size={42} strokeWidth={1.3} />
                  <span>
                    {v.page_count} SLIDES · VERSÃO {v.version}
                  </span>
                </div>
                <div className="training-content">
                  <div className="flex gap-2">
                    <span
                      className={`badge ${c.status === "published" ? "completed" : "not_started"}`}
                    >
                      <i />
                      {c.status === "published"
                        ? "Publicado"
                        : c.status === "archived"
                          ? "Arquivado"
                          : "Rascunho"}
                    </span>
                    {!v.published_at && c.status !== "draft" && (
                      <span className="badge in_progress">Novo rascunho</span>
                    )}
                  </div>
                  <h2>{v.title}</h2>
                  <p>
                    {v.description ||
                      "Adicione uma descrição para apresentar este treinamento."}
                  </p>
                  <div className="metadata">
                    <span>
                      {v.quiz_enabled ? "Com questionário" : "Sem questionário"}
                    </span>
                    <span>{versions.length} versão(ões)</span>
                  </div>
                  <div className="card-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditor({ course: c, version: v })}
                    >
                      <Pencil size={14} />
                      {v.published_at ? "Nova versão" : "Editar"}
                    </Button>
                    {published && c.status === "published" && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setError("");
                          setAssign(published);
                          setSelected([]);
                        }}
                      >
                        <Users size={14} /> Atribuir
                      </Button>
                    )}
                    <div className="card-icon-actions">
                      {c.status !== "archived" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Arquivar curso"
                          className="hover:bg-blue-100 hover:text-blue-700"
                          aria-label={`Arquivar ${v.title}`}
                          disabled={busy}
                          onClick={() => void archive(c)}
                        >
                          <Archive size={16} />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        title="Excluir curso"
                        aria-label={`Excluir ${v.title}`}
                        className="hover:bg-red-100 hover:text-red-700"
                        onClick={() => {
                          setError("");
                          setRemoving(c);
                          setDeleteAssignments(false);
                        }}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {visible?.length === 0 && (
        <Empty title="Nenhum curso por aqui">
          Crie um curso com uma apresentação PDF para começar.
        </Empty>
      )}
      {removing && (
        <Modal
          title="Excluir curso"
          close={() => {
            if (!busy) setRemoving(null);
          }}
        >
          <p>
            Excluir{" "}
            <strong>
              {
                [...removing.versions].sort((a, b) => b.version - a.version)[0]
                  ?.title
              }
            </strong>
            ?
          </p>
          <p>
            O curso e suas versões serão excluídos definitivamente. Para
            preservar as atribuições e o histórico, use Arquivar.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={deleteAssignments}
              disabled={busy}
              onChange={(event) => setDeleteAssignments(event.target.checked)}
            />
            <span>
              Apagar também as atribuições deste curso. Ele sumirá dos
              treinamentos e do histórico dos gerentes. Progresso, respostas e
              conclusões serão apagados definitivamente.
            </span>
          </label>
          <p className="muted">
            Sem marcar esta opção, somente cursos sem atribuições podem ser
            excluídos.
          </p>
          <ErrorNotice message={error} />
          <div className="form-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setRemoving(null);
                setError("");
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? "Excluindo..." : "Confirmar exclusão"}
            </Button>
          </div>
        </Modal>
      )}
      {editor && (
        <CourseEditor
          initial={editor}
          close={() => setEditor(null)}
          saved={async () => {
            await reload();
            setEditor(null);
          }}
        />
      )}{" "}
      {assign && (
        <Modal
          title={`Atribuir: ${assign.title}`}
          close={() => {
            if (!busy) setAssign(null);
          }}
        >
          <p className="muted">
            Versão {assign.version}. Atribuições existentes desta versão não
            serão duplicadas.
          </p>
          <div className="manager-picker">
            {users
              .filter((u) => u.role === "manager" && u.active)
              .map((u) => (
                <label className="check-label" key={u.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(u.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, u.id]
                          : selected.filter((id) => id !== u.id),
                      )
                    }
                  />
                  <span>
                    <strong>{u.name}</strong>
                    <small>{u.email}</small>
                  </span>
                </label>
              ))}
          </div>
          <ErrorNotice message={error} />
          <div className="form-actions">
            <Button
              disabled={busy || !selected.length}
              onClick={() => void assignManagers()}
            >
              {busy
                ? "Atribuindo..."
                : `Atribuir a ${selected.length} gerente(s)`}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function CourseEditor({
  initial,
  close,
  saved,
}: {
  initial: { course?: Course; version?: Version };
  close: () => void;
  saved: () => Promise<void>;
}) {
  const v = initial.version;
  const notify = useToast();
  const [title, setTitle] = useState(v?.title || "");
  const [description, setDescription] = useState(v?.description || "");
  const [quiz, setQuiz] = useState(v?.quiz_enabled || false);
  const [score, setScore] = useState(Number(v?.pass_score ?? 70));
  const [max, setMax] = useState(v?.max_attempts ?? 3);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useErrorState();
  const [ready, setReady] = useState(!v);
  // Retain the newly created course ID across upload/publish failures; retry cannot create duplicates.
  const courseId = useRef(initial.course?.id);
  const draftId = useRef(v && !v.published_at ? v.id : undefined);
  useEffect(() => {
    if (v)
      void api<Question[]>(`/admin/versions/${v.id}/questions`)
        .then((q) => {
          setQuestions(q);
          setReady(true);
        })
        .catch((e) => setError(e.message));
  }, [v]);
  function updateQuestion(index: number, value: Partial<Question>) {
    setQuestions((current) =>
      current.map((q, i) => (i === index ? { ...q, ...value } : q)),
    );
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const publish =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
      "publish";
    setBusy(true);
    setError("");
    try {
      if (publish && !file && !draftId.current)
        throw new Error("Selecione o PDF desta nova versão.");
      const body = {
        title,
        description,
        quiz_enabled: quiz,
        pass_score: score,
        max_attempts: max,
        questions: quiz ? questions : [],
      };
      const result = await api<{ version_id: string; course_id: string }>(
        courseId.current
          ? `/admin/courses/${courseId.current}/draft`
          : "/admin/courses",
        courseId.current ? "PUT" : "POST",
        body,
      );
      draftId.current = result.version_id;
      courseId.current = result.course_id;
      if (file) {
        const form = new FormData();
        form.append("pdf", file);
        await api(`/admin/versions/${result.version_id}/pdf`, "POST", form);
        setFile(null);
      }
      if (publish)
        await api(`/admin/versions/${result.version_id}/publish`, "POST");
      await saved();
      notify(
        publish
          ? "Curso publicado com sucesso."
          : "Rascunho salvo com sucesso.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        v?.published_at
          ? "Criar nova versão"
          : initial.course
            ? "Editar rascunho"
            : "Criar curso"
      }
      close={() => {
        if (!busy) close();
      }}
    >
      <form onSubmit={save}>
        {v?.published_at && (
          <div className="notice">
            As conclusões e atribuições anteriores continuarão vinculadas à
            versão {v.version}. Envie o PDF para a nova versão.
          </div>
        )}
        <label>
          Título do curso
          <input
            required
            maxLength={150}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </label>
        <label>
          Descrição
          <textarea
            rows={3}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="O que a equipe vai aprender?"
          />
        </label>
        <label className="upload-field">
          <FileUp size={25} />
          <strong>
            {file?.name ||
              (!v?.published_at && v?.pdf_path
                ? "Substituir apresentação PDF"
                : "Selecionar apresentação PDF")}
          </strong>
          <span>Até 20 MB e 500 páginas · sem senha</span>
          <input
            aria-label="Apresentação PDF"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={quiz}
            onChange={(e) => setQuiz(e.target.checked)}
          />
          <strong>Incluir questionário de avaliação</strong>
        </label>
        {quiz && (
          <section className="quiz-editor">
            <div className="form-grid">
              <label>
                Nota mínima (%)
                <input
                  type="number"
                  min={1}
                  max={100}
                  required
                  value={score}
                  onChange={(e) => setScore(Number(e.target.value))}
                />
              </label>
              <label>
                Máximo de tentativas
                <input
                  type="number"
                  min={1}
                  max={20}
                  required
                  value={max}
                  onChange={(e) => setMax(Number(e.target.value))}
                />
              </label>
            </div>
            {questions.map((q, i) => (
              <div className="question-editor" key={i}>
                <div className="flex items-center justify-between">
                  <strong>Questão {i + 1}</strong>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover questão ${i + 1}`}
                    onClick={() =>
                      setQuestions(questions.filter((_, j) => j !== i))
                    }
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
                <label>
                  Enunciado
                  <input
                    required
                    maxLength={2000}
                    value={q.prompt}
                    onChange={(e) =>
                      updateQuestion(i, { prompt: e.target.value })
                    }
                  />
                </label>
                <small>Marque a alternativa correta.</small>
                {q.options.map((o, j) => (
                  <div className="option-editor" key={j}>
                    <input
                      type="radio"
                      aria-label={`Questão ${i + 1}, correta ${j + 1}`}
                      name={`correct-${i}`}
                      checked={q.correct_index === j}
                      onChange={() => updateQuestion(i, { correct_index: j })}
                    />
                    <input
                      aria-label={`Questão ${i + 1}, alternativa ${j + 1}`}
                      required
                      maxLength={500}
                      value={o}
                      onChange={(e) =>
                        updateQuestion(i, {
                          options: q.options.map((x, k) =>
                            k === j ? e.target.value : x,
                          ),
                        })
                      }
                    />
                    {q.options.length > 2 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover alternativa ${j + 1}`}
                        onClick={() =>
                          updateQuestion(i, {
                            options: q.options.filter((_, k) => k !== j),
                            correct_index: 0,
                          })
                        }
                      >
                        <X size={15} />
                      </Button>
                    )}
                  </div>
                ))}
                {q.options.length < 6 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updateQuestion(i, { options: [...q.options, ""] })
                    }
                  >
                    + Alternativa
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={!ready || questions.length >= 50}
              onClick={() =>
                setQuestions([
                  ...questions,
                  { prompt: "", options: ["", ""], correct_index: 0 },
                ])
              }
            >
              <Plus size={16} /> Adicionar questão
            </Button>
          </section>
        )}
        <ErrorNotice message={error} />
        <div className="form-actions">
          <Button
            type="submit"
            value="draft"
            variant="outline"
            disabled={busy || !ready}
          >
            {busy ? "Salvando..." : "Salvar rascunho"}
          </Button>
          <Button type="submit" value="publish" disabled={busy || !ready}>
            <Check size={16} /> Publicar curso
          </Button>
        </div>
      </form>
    </Modal>
  );
}
