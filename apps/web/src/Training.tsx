import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?worker&url";
import { api } from "./lib";
import { useToast, useErrorState } from "./components/Toast";
import { type Assignment, type Attempt, date } from "./types";
import { Button } from "./components/ui/button";
import { ErrorNotice, Loading, Progress } from "./components/shared";
GlobalWorkerOptions.workerSrc = workerUrl;

export function Training() {
  const notify = useToast();
  const { id } = useParams();
  const [data, setData] = useState<Assignment | null>(null);
  const [page, setPage] = useState(1);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useErrorState();
  const [saveError, setSaveError] = useErrorState();
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<Attempt | null>(null);
  const [retry, setRetry] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const requestId = useRef<string | null>(null);
  const reload = useCallback(async () => {
    const a = await api<Assignment>(`/assignments/${id}`);
    setData(a);
    return a;
  }, [id]);
  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    async function load() {
      try {
        setError("");
        await api(`/assignments/${id}/start`, "POST");
        const a = await api<Assignment>(`/assignments/${id}`);
        if (!active) return;
        setData(a);
        setPage(a.last_slide);
        const link = await api<{ url: string }>(`/assignments/${id}/pdf`);
        if (!active) return;
        // Download once while the short-lived link is valid. Later slides must not
        // depend on expired range requests during a long training session.
        const response = await fetch(link.url);
        if (!response.ok)
          throw new Error(
            "Não foi possível baixar a apresentação. Recarregue o treinamento.",
          );
        const bytes = await response.arrayBuffer();
        if (!active) return;
        task = getDocument({ data: bytes });
        const doc = await task.promise;
        if (active) setPdf(doc);
        else await task.destroy();
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }
    void load();
    return () => {
      active = false;
      void task?.destroy();
    };
  }, [id, retry]);
  const markViewed = useCallback(
    async (currentPage: number) => {
      setSaving(true);
      setSaveError("");
      try {
        await api(`/assignments/${id}/views`, "POST", { page: currentPage });
        await reload();
      } catch {
        setSaveError(
          "Não foi possível salvar este slide. Confira sua conexão e tente novamente.",
        );
      } finally {
        setSaving(false);
      }
    },
    [id, reload],
  );
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true;
    let task:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    setRendered(false);
    void pdf
      .getPage(page)
      .then(async (p) => {
        if (!active || !canvas.current) return;
        const viewport = p.getViewport({ scale: 1.5 });
        const el = canvas.current;
        el.width = viewport.width;
        el.height = viewport.height;
        task = p.render({
          canvas: el,
          canvasContext: el.getContext("2d")!,
          viewport,
        });
        await task.promise;
        if (active) {
          setRendered(true);
          await markViewed(page);
        }
      })
      .catch((e) => {
        if (active && e.name !== "RenderingCancelledException")
          setError("Não foi possível exibir o PDF. Tente carregar novamente.");
      });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [pdf, page, markViewed]);
  async function complete() {
    setBusy(true);
    setError("");
    try {
      await api(`/assignments/${id}/complete`, "POST");
      await reload();
      notify("Conclusão do treinamento registrada com sucesso.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      const r = await api<Attempt>(`/assignments/${id}/attempts`, "POST", {
        request_id: requestId.current,
        answers,
      });
      setResult(r);
      requestId.current = null;
      setAnswers({});
      await reload();
      notify(
        "Respostas enviadas com sucesso. Confira o resultado da avaliação.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const allViewed = Boolean(
    data && data.views.length === data.version.page_count,
  );
  return (
    <>
      <Link className="back-link" to="/meus-cursos">
        <ArrowLeft size={16} /> Meus treinamentos
      </Link>
      <ErrorNotice message={error} />
      {error && (
        <Button variant="outline" onClick={() => setRetry(retry + 1)}>
          <RefreshCw size={16} /> Recarregar treinamento
        </Button>
      )}
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                TREINAMENTO · VERSÃO {data.version.version}
              </span>
              <h1>{data.version.title}</h1>
              <p>{data.version.description}</p>
            </div>
          </div>
          <div className="viewer-layout">
            <section className="panel viewer">
              <div className="viewer-header">
                <span>Apresentação</span>
                <span>
                  Slide {page} de {data.version.page_count}
                </span>
              </div>
              <div className="canvas-wrap" aria-busy={!rendered}>
                {!pdf && <Loading />}
                <canvas
                  ref={canvas}
                  aria-label={`Slide ${page} da apresentação`}
                />
              </div>
              <div className="viewer-controls">
                <Button
                  variant="outline"
                  disabled={page <= 1 || saving || !rendered}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={16} /> Anterior
                </Button>
                <span>
                  {page} / {data.version.page_count}
                </span>
                <Button
                  disabled={
                    page >= data.version.page_count || saving || !rendered
                  }
                  onClick={() => setPage(page + 1)}
                >
                  Próximo <ChevronRight size={16} />
                </Button>
              </div>
              <div className="save-state" role="status">
                {saving ? (
                  "Salvando progresso..."
                ) : saveError ? (
                  <>
                    <ErrorNotice message={saveError} />
                    <Button size="sm" onClick={() => void markViewed(page)}>
                      Tentar salvar novamente
                    </Button>
                  </>
                ) : rendered ? (
                  <>
                    <CheckCircle2 size={15} /> Progresso salvo
                  </>
                ) : (
                  "Carregando slide..."
                )}
              </div>
            </section>
            <aside className="panel learning-progress">
              <span className="course-icon">
                <ShieldCheck size={24} />
              </span>
              <h2>Seu progresso</h2>
              <p>
                {data.views.length} de {data.version.page_count} slides
                visualizados
              </p>
              <Progress
                value={Math.round(
                  (data.views.length / data.version.page_count) * 100,
                )}
              />
              <div className="learning-step">
                <CheckCircle2
                  size={18}
                  className={allViewed ? "text-green-700" : "text-gray-400"}
                />
                <span>Visualizar a apresentação</span>
              </div>
              <div className="learning-step">
                <CheckCircle2
                  size={18}
                  className={
                    data.completion ? "text-green-700" : "text-gray-400"
                  }
                />
                <span>
                  {data.version.quiz_enabled
                    ? `Aprovação com ${data.version.pass_score}%`
                    : "Confirmar conclusão"}
                </span>
              </div>
              {data.completion ? (
                <div className="success">
                  <strong>Treinamento concluído!</strong>
                  <p>{date(data.completion.completed_at)}</p>
                </div>
              ) : !data.version.quiz_enabled ? (
                <Button
                  className="w-full"
                  disabled={!allViewed || busy || saving}
                  onClick={() => void complete()}
                >
                  {busy ? "Concluindo..." : "Confirmar conclusão"}
                </Button>
              ) : (
                <p className="muted">
                  {allViewed
                    ? "Responda ao questionário abaixo para concluir."
                    : "O questionário será liberado após visualizar todos os slides."}
                </p>
              )}
              <small className="muted">
                Você pode sair e continuar de onde parou.
              </small>
            </aside>
          </div>
          {data.version.quiz_enabled && allViewed && (
            <section className="panel quiz-panel">
              <div className="panel-heading">
                <div>
                  <h2>Questionário de avaliação</h2>
                  <p>
                    Nota mínima: {data.version.pass_score}% ·{" "}
                    {data.attempts.length} de {data.version.max_attempts}{" "}
                    tentativas utilizadas
                  </p>
                </div>
              </div>
              {result && (
                <div
                  className={result.passed ? "success" : "notice"}
                  role="status"
                >
                  Nota: {Number(result.score).toFixed(1)}% ·{" "}
                  {result.passed
                    ? "Aprovado. Parabéns pela conclusão!"
                    : "A nota mínima ainda não foi atingida."}
                </div>
              )}
              {!data.completion &&
              data.attempts.length < data.version.max_attempts ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  {data.questions?.map((q, i) => (
                    <fieldset key={q.id}>
                      <legend>
                        {i + 1}. {q.prompt}
                      </legend>
                      {q.options.map((o, j) => (
                        <label key={j} className="quiz-option">
                          <input
                            type="radio"
                            required
                            name={q.id}
                            checked={answers[q.id!] === j}
                            disabled={busy}
                            onChange={() => {
                              requestId.current = null;
                              setAnswers({ ...answers, [q.id!]: j });
                            }}
                          />
                          <span>{o}</span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                  <Button
                    disabled={
                      busy ||
                      Object.keys(answers).length !== data.questions?.length
                    }
                  >
                    {busy ? "Enviando..." : "Enviar respostas"}
                  </Button>
                </form>
              ) : (
                !data.completion && (
                  <div className="notice">
                    Limite de tentativas atingido. Procure seu administrador.
                  </div>
                )
              )}
              {data.attempts.length > 0 && (
                <div className="attempt-history">
                  <h3>Suas tentativas</h3>
                  {[...data.attempts]
                    .sort((a, b) => a.attempt - b.attempt)
                    .map((t) => (
                      <div key={t.id}>
                        <span>
                          Tentativa {t.attempt} · {date(t.submitted_at)}
                        </span>
                        <strong>
                          {Number(t.score).toFixed(1)}% ·{" "}
                          {t.passed ? "Aprovado" : "Reprovado"}
                        </strong>
                      </div>
                    ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
