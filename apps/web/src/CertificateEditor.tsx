import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?worker&url";
import type { CertificateConfig } from "../../api/src/certificates";
import { defaultCertificate } from "../../api/src/certificate-default";
import { apiBlob, downloadBlob } from "./lib";
import { Button } from "./components/ui/button";
import { ErrorNotice } from "./components/shared";

export { defaultCertificate } from "../../api/src/certificate-default";
GlobalWorkerOptions.workerSrc = workerUrl;
export type CertificateDraft = {
  enabled: boolean;
  config: CertificateConfig;
  dirty: boolean;
};
const labels = {
  nome: "Nome do participante (obrigatório)",
  cpf: "CPF",
  curso: "Nome do curso",
  carga_horaria: "Carga horária",
  data_conclusao: "Data de conclusão",
  codigo_certificado: "Código do certificado",
};
export function CertificateEditor({
  value,
  onChange,
  disabled,
}: {
  value: CertificateDraft;
  onChange: (value: CertificateDraft) => void;
  disabled: boolean;
}) {
  const [preview, setPreview] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 842, height: 595 });
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof getDocument> | undefined;
    let rendering: RenderTask | undefined;
    setBusy(true);
    setPreview(null);
    setError("");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const form = new FormData();
          form.append("config", JSON.stringify(value.config));
          const blob = await apiBlob(
            "/admin/certificates/preview",
            "POST",
            form,
          );
          if (!active) return;
          task = getDocument({ data: await blob.arrayBuffer() });
          const pdf = await task.promise;
          if (!active || !canvas.current) return;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 1.5 });
          setDimensions({ width: viewport.width, height: viewport.height });
          canvas.current.width = viewport.width;
          canvas.current.height = viewport.height;
          rendering = page.render({ canvas: canvas.current, viewport });
          await rendering.promise;
          if (active) setPreview(blob);
        } catch (e) {
          if (active) setError((e as Error).message);
        } finally {
          if (active) setBusy(false);
        }
      })();
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
      rendering?.cancel();
      void task?.destroy();
    };
  }, [value.config, retry]);
  return (
    <>
      <fieldset className="certificate-options" disabled={disabled}>
        <legend>Informações no certificado</legend>
        <div className="form-grid">
          {defaultCertificate.fields.map((field) => (
            <label className="check-label" key={field.key}>
              <input
                type="checkbox"
                checked={value.config.fields.some(
                  (item) => item.key === field.key,
                )}
                disabled={field.key === "nome"}
                onChange={(event) => {
                  const selected = new Set(
                    value.config.fields.map((item) => item.key),
                  );
                  if (event.target.checked) selected.add(field.key);
                  else selected.delete(field.key);
                  onChange({
                    ...value,
                    dirty: true,
                    config: {
                      ...value.config,
                      fields: defaultCertificate.fields.filter((item) =>
                        selected.has(item.key),
                      ),
                    },
                  });
                }}
              />
              {labels[field.key]}
            </label>
          ))}
        </div>
        {value.config.fields.some((field) => field.key === "carga_horaria") && (
          <label>
            Carga horária do curso
            <input
              maxLength={60}
              value={value.config.hours}
              onChange={(event) =>
                onChange({
                  ...value,
                  dirty: true,
                  config: { ...value.config, hours: event.target.value },
                })
              }
            />
          </label>
        )}
      </fieldset>
      <p role="status">
        {busy
          ? "Atualizando prévia..."
          : error
            ? "Não foi possível carregar a prévia."
            : "Prévia com dados fictícios."}
      </p>
      <div
        className="certificate-canvas certificate-preview"
        style={{ aspectRatio: `${dimensions.width}/${dimensions.height}` }}
      >
        <canvas
          ref={canvas}
          aria-label="Prévia do certificado preenchido"
          style={{ visibility: preview ? "visible" : "hidden" }}
        />
      </div>
      <ErrorNotice message={error} />
      <div className="form-actions">
        {error && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setRetry((count) => count + 1)}
          >
            Tentar novamente
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={busy || !preview}
          onClick={() => {
            if (preview) downloadBlob(preview, "previa-certificado.pdf");
          }}
        >
          Baixar prévia
        </Button>
      </div>
    </>
  );
}
