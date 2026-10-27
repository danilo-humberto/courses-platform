import { useEffect, useState } from "react";
import { api, apiBlob, downloadBlob } from "./lib";
import { Button } from "./components/ui/button";
import { ErrorNotice } from "./components/shared";
import { useErrorState } from "./components/Toast";
import { date } from "./types";
type IssuedCertificate = {
  id: string;
  assignment_id: string;
  course_title: string;
  completed_at: string;
};
export function Certificates({ assignmentId }: { assignmentId?: string }) {
  const [rows, setRows] = useState<IssuedCertificate[]>([]);
  const [error, setError] = useErrorState();
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api<IssuedCertificate[]>("/certificates")
      .then((data) => {
        if (active) setRows(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function download(id: string) {
    setBusy(id);
    setError("");
    try {
      downloadBlob(await apiBlob(`/certificates/${id}/pdf`), "certificado.pdf");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const visible = rows.filter(
    (r) => !assignmentId || r.assignment_id === assignmentId,
  );
  return (
    <section aria-label="Certificados emitidos">
      {!assignmentId && <h2>Certificados emitidos</h2>}
      {!assignmentId && !visible.length && !error && (
        <p>Nenhum certificado emitido.</p>
      )}
      {visible.map((r) => (
        <div key={r.id} className="certificate-issued">
          {!assignmentId && (
            <p>
              <strong>{r.course_title}</strong> · {date(r.completed_at)}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void download(r.id)}
          >
            {busy === r.id ? "Preparando PDF..." : "Baixar certificado"}
          </Button>
        </div>
      ))}
      <ErrorNotice message={error} />
    </section>
  );
}
