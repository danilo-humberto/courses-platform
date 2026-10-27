import { useState } from "react";
import { Filter, Info } from "lucide-react";
import { api } from "./lib";
import { Modal } from "./Administration";
import { Button } from "./components/ui/button";
import { ErrorNotice } from "./components/shared";

type Preview = {
  total: number;
  dismissed: number;
  rows: {
    row: number;
    data: {
      name: string;
      email: string;
      state: string;
      cpf: string;
      cost_center: string;
      job_name: string;
    };
    errors: string[];
  }[];
  results?: { row: number; status: string; message?: string }[];
};
export function EmployeeImport({
  close,
  reload,
}: {
  close: () => void;
  reload: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [ignorePending, setIgnorePending] = useState(false);
  function filterPending(enabled: boolean) {
    setPendingOnly(enabled);
    setPage(0);
  }
  async function submit(mode: "preview" | "confirm") {
    if (!file || busy) return;
    if (
      mode === "confirm" &&
      preview?.rows.some((row) => row.errors.length > 0) &&
      !ignorePending
    )
      return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      if (mode === "confirm" && ignorePending)
        body.append("ignorePending", "true");
      const result = await api<Preview>(
        `/admin/users/import/${mode}`,
        "POST",
        body,
      );
      setPreview(result);
      setPage(0);
      setPendingOnly(false);
      if (mode === "confirm") await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const valid = preview?.rows.filter((row) => !row.errors.length).length ?? 0;
  const visibleRows =
    preview?.rows.filter((row) => !pendingOnly || row.errors.length > 0) ?? [];
  return (
    <Modal
      title="Importar funcionários"
      wide
      close={() => {
        if (!busy) close();
      }}
    >
      <p>
        Selecione o CSV do RH. Somente registros sem data de desligamento serão
        considerados. E-mail é opcional; CPF é obrigatório. Os funcionários
        serão cadastrados sem senha.
      </p>
      <label className="employee-file-picker">
        <span className="employee-file-title">Base de funcionários</span>
        <span className="employee-file-hint">Arquivo CSV de até 8 MB</span>
        <input
          className="employee-file-input"
          aria-label="Base de funcionários (CSV, até 8 MB)"
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
            setIgnorePending(false);
            filterPending(false);
            setError("");
          }}
        />
        <span className="employee-file-button">Escolher arquivo</span>
        <span className="employee-file-name" aria-live="polite">
          {file?.name ?? "Nenhum arquivo selecionado"}
        </span>
      </label>
      <ErrorNotice message={error} />
      {preview && (
        <>
          <div
            className="employee-import-summary"
            role="status"
            aria-label="Resumo da limpeza"
          >
            {[
              {
                label: "Registros na base",
                value: preview.total,
                tone: "total",
              },
              {
                label: "Desligados ignorados",
                value: preview.dismissed,
                tone: "ignored",
              },
              { label: "Aptos para cadastro", value: valid, tone: "ready" },
              {
                label: "Com pendências",
                value: preview.rows.length - valid,
                tone: "pending",
              },
            ].map(({ label, value, tone }) =>
              tone === "pending" ? (
                <button
                  type="button"
                  className="employee-import-stat employee-import-stat--pending employee-import-stat-filter"
                  key={tone}
                  aria-pressed={pendingOnly}
                  aria-controls="employee-import-table"
                  disabled={value === 0}
                  onClick={() => filterPending(!pendingOnly)}
                >
                  <strong>{value.toLocaleString("pt-BR")}</strong>
                  <span>{label}</span>
                  <span className="employee-import-filter-hint">
                    <Filter size={14} aria-hidden="true" />
                    {value === 0
                      ? "Nenhuma pendência"
                      : pendingOnly
                        ? "Filtro ativo · mostrar todos"
                        : "Ver pendências"}
                  </span>
                </button>
              ) : (
                <div
                  className={`employee-import-stat employee-import-stat--${tone}`}
                  key={tone}
                >
                  <strong>{value.toLocaleString("pt-BR")}</strong>
                  <span>{label}</span>
                </div>
              ),
            )}
          </div>
          <div className="employee-import-notice">
            <Info size={20} aria-hidden="true" />
            <p>
              <strong>Seus cadastros atuais serão preservados.</strong>
              <span>
                CPFs ou e-mails já cadastrados serão ignorados na confirmação.
                Nenhum cadastro existente será atualizado.
              </span>
            </p>
          </div>
          {preview.results && (
            <p role="status">
              Importação concluída:{" "}
              {preview.results.filter((r) => r.status === "created").length}{" "}
              cadastrados;{" "}
              {preview.results.filter((r) => r.status === "duplicate").length}{" "}
              já existentes.
            </p>
          )}
          {preview.rows.length > valid && !preview.results && (
            <p className="employee-import-decision" role="status">
              {ignorePending
                ? `${preview.rows.length - valid} registro(s) com pendências serão ignorados. Somente os ${valid} aptos serão cadastrados.`
                : "Cadastro bloqueado: corrija a base ou use “Ignorar pendências” para continuar somente com os registros aptos."}
            </p>
          )}
          {pendingOnly && (
            <div className="employee-import-filter-bar">
              <span role="status">
                Mostrando apenas registros com pendências:{" "}
                {visibleRows.length.toLocaleString("pt-BR")}.
              </span>
              <div className="employee-import-filter-actions">
                {!preview.results && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setIgnorePending(!ignorePending)}
                  >
                    {ignorePending
                      ? "Reconsiderar pendências"
                      : "Ignorar pendências"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => filterPending(false)}
                >
                  Mostrar todos
                </Button>
              </div>
            </div>
          )}
          <div className="table-wrap" id="employee-import-table">
            <table>
              <thead>
                <tr>
                  {[
                    "Registro",
                    "Nome",
                    "E-mail",
                    "Estado",
                    "CPF",
                    "Centro de custo",
                    "Função",
                    "Resultado",
                  ].map((v) => (
                    <th key={v}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.slice(page * 25, (page + 1) * 25).map((row) => {
                  const result = preview.results?.find(
                    (r) => r.row === row.row,
                  );
                  return (
                    <tr key={row.row}>
                      <td>{row.row}</td>
                      <td>{row.data.name}</td>
                      <td>{row.data.email || "—"}</td>
                      <td>{row.data.state}</td>
                      <td>{row.data.cpf}</td>
                      <td>{row.data.cost_center}</td>
                      <td>{row.data.job_name}</td>
                      <td>
                        {ignorePending && row.errors.length > 0 && (
                          <strong>Ignorado · </strong>
                        )}
                        {row.errors.join(" ") ||
                          (result
                            ? result.status === "created"
                              ? "Cadastrado"
                              : result.message
                            : "Apto")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <Button
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </Button>
            <span>
              Página {page + 1} de{" "}
              {Math.max(1, Math.ceil(visibleRows.length / 25))}
            </span>
            <Button
              variant="outline"
              disabled={(page + 1) * 25 >= visibleRows.length}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </Button>
          </div>
        </>
      )}
      <div className="form-actions">
        <Button variant="outline" disabled={busy} onClick={close}>
          Fechar
        </Button>
        {!preview ? (
          <Button
            disabled={!file || busy}
            onClick={() => void submit("preview")}
          >
            {busy ? "Analisando..." : "Analisar e limpar"}
          </Button>
        ) : (
          !preview.results && (
            <Button
              disabled={
                busy ||
                !valid ||
                (preview.rows.length > valid && !ignorePending)
              }
              onClick={() => void submit("confirm")}
            >
              {busy ? "Importando..." : `Cadastrar ${valid} funcionários`}
            </Button>
          )
        )}
      </div>
    </Modal>
  );
}
