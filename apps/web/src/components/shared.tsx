import type { ReactNode } from "react";
import { LoaderCircle, SearchX } from "lucide-react";
import { statusNames } from "../types";
export function Logo() {
  return (
    <div className="brand">
      <img
        className="brand-icon"
        src="/logo-cifra.png"
        alt=""
        width={44}
        height={52}
      />
      <span>CIFRA</span>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="animate-spin" size={22} /> Carregando...
    </div>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return message ? <div className="error">{message}</div> : null;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <SearchX size={32} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Badge({ status }: { status: keyof typeof statusNames }) {
  return (
    <span className={`badge ${status}`}>
      <i />
      {statusNames[status]}
    </span>
  );
}
export function Progress({ value }: { value: number }) {
  return (
    <div className="progress-row">
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${value}%` }} />
      </div>
      <span>{value}%</span>
    </div>
  );
}
