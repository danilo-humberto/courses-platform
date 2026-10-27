export type Profile = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager";
  is_supreme?: boolean;
  active: boolean;
  deleted_at?: string | null;
  auth_user_id?: string | null;
  job_id?: string | null;
  job?: { id: string; name: string } | null;
  cpf?: string | null;
  state?: string;
  cost_center?: string;
  professional_function?: string;
  credential_pending?: boolean;
};
export type JobPosition = { id: string; name: string; description: string };
export type Question = {
  id?: string;
  prompt: string;
  options: string[];
  correct_index?: number;
  position?: number;
};
export type Version = {
  certificate?:
    | (import("../../api/src/certificates").CertificateConfig & {
        path: string;
      })
    | null;
  id: string;
  course_id: string;
  version: number;
  title: string;
  description: string;
  pdf_path: string | null;
  page_count: number;
  quiz_enabled: boolean;
  pass_score: number;
  max_attempts: number;
  published_at: string | null;
};
export type Course = {
  id: string;
  status: "draft" | "published" | "archived";
  versions: Version[];
};
export type Attempt = {
  id: string;
  attempt: number;
  score: number;
  passed: boolean;
  submitted_at: string;
};
export type Assignment = {
  id: string;
  manager_id: string;
  version_id: string;
  version: Version;
  manager: Profile;
  started_at: string | null;
  last_slide: number;
  completion: { completed_at: string } | null;
  views: { page: number }[];
  attempts: Attempt[];
  status: "not_started" | "in_progress" | "completed";
  progress: number;
  questions?: Question[];
};
export const statusNames = {
  not_started: "Não iniciado",
  in_progress: "Em andamento",
  completed: "Concluído",
};
export const date = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
