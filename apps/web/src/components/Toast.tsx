import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { createPortal } from "react-dom";

type ToastKind = "success" | "error";
const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(
  () => {},
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{
    id: number;
    message: string;
    kind: ToastKind;
    target: Element;
  } | null>(null);
  const nextId = useRef(0);
  const [closing, setClosing] = useState(false);
  const [paused, setPaused] = useState(false);
  const notify = useCallback((message: string, kind: ToastKind = "success") => {
    setPaused(false);
    setClosing(false);
    // Error notifications must remain interactive above a native modal's backdrop.
    const target =
      kind === "error"
        ? (document.querySelector("dialog[open]") ?? document.body)
        : document.body;
    setToast({ id: ++nextId.current, message, kind, target });
  }, []);
  useEffect(() => {
    if (!toast || paused || closing) return;
    const timer = window.setTimeout(() => setClosing(true), 6000);
    return () => window.clearTimeout(timer);
  }, [toast, paused, closing]);
  useEffect(() => {
    if (!toast || !closing) return;
    // Also remove the toast when animations are disabled or interrupted.
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 300;
    const timer = window.setTimeout(() => setToast(null), delay);
    return () => window.clearTimeout(timer);
  }, [toast, closing]);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      {createPortal(
        <div
          className="toast-region"
          role={toast?.kind === "error" ? "alert" : "status"}
          aria-live={toast?.kind === "error" ? "assertive" : "polite"}
          aria-atomic="true"
        >
          {toast && (
            <div
              key={toast.id}
              className={`system-toast${toast.kind === "error" ? " toast-error" : ""}${closing ? " is-closing" : ""}`}
              onAnimationEnd={(event) => {
                if (
                  event.target === event.currentTarget &&
                  event.animationName === "toast-exit"
                )
                  setToast(null);
              }}
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
            >
              {toast.kind === "error" ? (
                <CircleAlert size={23} aria-hidden="true" />
              ) : (
                <CheckCircle2 size={23} aria-hidden="true" />
              )}
              <div>
                <strong>
                  {toast.kind === "error"
                    ? "Não foi possível concluir"
                    : "Tudo certo!"}
                </strong>
                <p>{toast.message}</p>
              </div>
              <button
                type="button"
                aria-label="Fechar notificação"
                onClick={() => setClosing(true)}
              >
                <X size={18} />
              </button>
            </div>
          )}
        </div>,
        toast?.target.isConnected ? toast.target : document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// Notify at the failure event, including retries with the same message. Clearing errors is silent.
export function useErrorState() {
  const [error, setError] = useState("");
  const notify = useToast();
  const reportError = useCallback(
    (message: string) => {
      setError(message);
      if (message) notify(message, "error");
    },
    [notify],
  );
  return [error, reportError] as const;
}
