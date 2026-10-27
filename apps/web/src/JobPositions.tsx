import { useEffect, useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2, Users, Search } from "lucide-react";
import { api } from "./lib";
import type { JobPosition, Profile } from "./types";
import { Modal } from "./Administration";
import { Button } from "./components/ui/button";
import { Empty, ErrorNotice, Loading } from "./components/shared";
import { useToast, useErrorState } from "./components/Toast";

type Dialog =
  | { kind: "edit"; job: JobPosition | null }
  | { kind: "assign" | "delete"; job: JobPosition };
export function JobPositions() {
  const notify = useToast();
  const [jobs, setJobs] = useState<JobPosition[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useErrorState();
  const [search, setSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [assignmentReady, setAssignmentReady] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    setError("");
    try {
      const [positions, profiles] = await Promise.all([
        api<JobPosition[]>("/admin/jobs"),
        api<Profile[]>("/admin/users"),
      ]);
      setJobs(positions);
      setUsers(profiles);
    } catch (e) {
      setLoadFailed(true);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function open(next: Dialog) {
    setError("");
    setDialog(next);
  }
  async function openAssignment(job: JobPosition) {
    open({ kind: "assign", job });
    setSelected([]);
    setUserSearch("");
    setAssignmentReady(false);
    setBusy(true);
    try {
      setUsers(await api<Profile[]>("/admin/users"));
      setAssignmentReady(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || dialog?.kind !== "edit") return;
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get("name")).trim(),
      description: String(form.get("description")).trim(),
    };
    const existing = dialog.job;
    setBusy(true);
    setError("");
    try {
      if (existing) {
        await api(`/admin/jobs/${existing.id}`, "PATCH", body);
        setJobs((current) =>
          current.map((job) =>
            job.id === existing.id ? { ...job, ...body } : job,
          ),
        );
        setUsers((current) =>
          current.map((user) =>
            user.job_id === existing.id
              ? { ...user, job: { id: existing.id, name: body.name } }
              : user,
          ),
        );
      } else {
        const created = await api<{ id: string }>("/admin/jobs", "POST", body);
        setJobs((current) => [...current, { id: created.id, ...body }]);
      }
      setDialog(null);
      notify(
        existing
          ? "Cargo atualizado com sucesso."
          : "Cargo cadastrado com sucesso.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function assign() {
    if (
      busy ||
      dialog?.kind !== "assign" ||
      !assignmentReady ||
      !selected.length
    )
      return;
    const job = dialog.job;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/jobs/${job.id}/assign`, "POST", { users: selected });
      setUsers((current) =>
        current.map((user) =>
          selected.includes(user.id)
            ? { ...user, job_id: job.id, job: { id: job.id, name: job.name } }
            : user,
        ),
      );
      setDialog(null);
      notify(`Cargo atribuído a ${selected.length} usuário(s).`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (busy || dialog?.kind !== "delete") return;
    const job = dialog.job;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/jobs/${job.id}`, "DELETE");
      setJobs((current) => current.filter((item) => item.id !== job.id));
      setUsers((current) =>
        current.map((user) =>
          user.job_id === job.id ? { ...user, job_id: null, job: null } : user,
        ),
      );
      setDialog(null);
      notify(
        "Cargo excluído. Os usuários e seus treinamentos foram preservados.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const visible = jobs
    .filter((job) =>
      `${job.name} ${job.description}`
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const eligible = users.filter(
    (user) => user.role === "manager" && user.active && !user.deleted_at,
  );
  const matchingUsers = eligible.filter((user) =>
    `${user.name} ${user.email}`
      .toLocaleLowerCase("pt-BR")
      .includes(userSearch.toLocaleLowerCase("pt-BR")),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ORGANIZAÇÃO DA EQUIPE</span>
          <h1>Cargos</h1>
          <p>Cadastre cargos e atribua a vários usuários de uma vez.</p>
        </div>
        <Button
          disabled={loading || loadFailed}
          onClick={() => open({ kind: "edit", job: null })}
        >
          <Plus size={17} /> Cadastrar cargo
        </Button>
      </div>
      {!dialog && <ErrorNotice message={error} />}
      <div className="filters">
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Buscar cargo"
            placeholder="Buscar por nome ou descrição..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <section className="panel">
        {loading ? (
          <Loading />
        ) : loadFailed ? (
          <Button onClick={() => void load()}>Tentar novamente</Button>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cargo</th>
                    <th>Descrição</th>
                    <th>Usuários</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <strong>{job.name}</strong>
                      </td>
                      <td>{job.description || "—"}</td>
                      <td>
                        {
                          users.filter(
                            (user) =>
                              user.job_id === job.id && !user.deleted_at,
                          ).length
                        }
                      </td>
                      <td>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Atribuir ${job.name}`}
                          onClick={() => void openAssignment(job)}
                        >
                          <Users size={15} /> Atribuir
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Editar ${job.name}`}
                          onClick={() => open({ kind: "edit", job })}
                        >
                          <Pencil size={15} /> Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Excluir ${job.name}`}
                          onClick={() => open({ kind: "delete", job })}
                        >
                          <Trash2 size={15} /> Excluir
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!visible.length && (
              <Empty title="Nenhum cargo encontrado">
                Cadastre um cargo ou ajuste a busca.
              </Empty>
            )}
          </>
        )}
      </section>
      {dialog && (
        <Modal
          title={
            dialog.kind === "edit"
              ? dialog.job
                ? "Editar cargo"
                : "Cadastrar cargo"
              : `${dialog.kind === "assign" ? "Atribuir" : "Excluir"}: ${dialog.job.name}`
          }
          close={() => {
            if (!busy) setDialog(null);
          }}
        >
          {dialog.kind === "edit" && (
            <form onSubmit={(event) => void save(event)}>
              <label>
                Nome do cargo
                <input
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={dialog.job?.name ?? ""}
                  autoFocus
                  disabled={busy}
                />
              </label>
              <label>
                Descrição
                <textarea
                  name="description"
                  maxLength={2000}
                  defaultValue={dialog.job?.description ?? ""}
                  disabled={busy}
                />
              </label>
              <ErrorNotice message={error} />
              <div className="form-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDialog(null)}
                >
                  Cancelar
                </Button>
                <Button disabled={busy}>
                  {busy ? "Salvando..." : "Salvar cargo"}
                </Button>
              </div>
            </form>
          )}
          {dialog.kind === "delete" && (
            <>
              <p>
                Excluir o cargo <strong>{dialog.job.name}</strong>? Os usuários
                vinculados ficarão sem cargo. Contas, treinamentos e histórico
                serão preservados.
              </p>
              <ErrorNotice message={error} />
              <div className="form-actions">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDialog(null)}
                >
                  Cancelar
                </Button>
                <Button disabled={busy} onClick={() => void remove()}>
                  {busy ? "Excluindo..." : "Confirmar exclusão"}
                </Button>
              </div>
            </>
          )}
          {dialog.kind === "assign" && (
            <>
              <p>
                Cada usuário tem um cargo. A atribuição substituirá o cargo
                atual dos selecionados. Usuários já vinculados aparecem
                marcados.
              </p>
              {!assignmentReady && busy && <Loading />}
              {assignmentReady && (
                <>
                  <label className="search-field job-assignment-search">
                    <Search size={18} />
                    <input
                      aria-label="Buscar usuário para atribuir cargo"
                      placeholder="Buscar por nome ou e-mail..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <div className="manager-picker">
                    {matchingUsers.map((user) => {
                      const assigned = user.job_id === dialog.job.id;
                      return (
                        <label className="check-label" key={user.id}>
                          <input
                            type="checkbox"
                            checked={assigned || selected.includes(user.id)}
                            disabled={
                              busy ||
                              assigned ||
                              (selected.length >= 200 &&
                                !selected.includes(user.id))
                            }
                            onChange={(e) =>
                              setSelected((current) =>
                                e.target.checked
                                  ? [...current, user.id]
                                  : current.filter((id) => id !== user.id),
                              )
                            }
                          />
                          <span>
                            <strong>{user.name}</strong>
                            <small>{user.email}</small>
                            <small>
                              {assigned
                                ? "Já atribuído"
                                : `Cargo atual: ${user.job?.name ?? "Sem cargo"}`}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {!matchingUsers.length && (
                    <p>Nenhum usuário ativo encontrado.</p>
                  )}
                  <p className="muted">
                    Selecione até 200 usuários por vez. A busca preserva as
                    seleções.
                  </p>
                </>
              )}
              <ErrorNotice message={error} />
              <div className="form-actions">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDialog(null)}
                >
                  Cancelar
                </Button>
                {!assignmentReady && !busy && (
                  <Button onClick={() => void openAssignment(dialog.job)}>
                    Tentar novamente
                  </Button>
                )}
                <Button
                  disabled={busy || !assignmentReady || !selected.length}
                  onClick={() => void assign()}
                >
                  {busy && assignmentReady
                    ? "Atribuindo..."
                    : `Atribuir a ${selected.length} usuário(s)`}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
