import { useErrorState } from "./components/Toast";
import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  ShieldCheck,
  BookOpen,
  ChartNoAxesCombined,
} from "lucide-react";
import { configured, supabase } from "./lib";
import { Logo, ErrorNotice } from "./components/shared";
import { Button } from "./components/ui/button";
import { loginEmail } from "./login";
export function Auth({ recovery = false }: { recovery?: boolean }) {
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useErrorState();
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      if (!supabase)
        throw new Error(
          "O ambiente ainda não foi configurado. Consulte o responsável pela plataforma.",
        );
      if (recovery) {
        const { error } = await supabase.auth.updateUser({
          password: String(form.get("password")),
        });
        if (error)
          throw new Error(
            "Não foi possível atualizar a senha. Solicite um novo link.",
          );
        await supabase.auth.signOut();
        window.location.assign("/");
      } else if (reset) {
        if (
          /^\d{11}(?:@cifraengenharia\.com\.br)?$/i.test(
            String(form.get("email")).trim(),
          )
        ) {
          setNotice(
            "Para recuperar o acesso por CPF, procure o administrador. O endereço interno não recebe e-mails.",
          );
          return;
        }
        await supabase.auth.resetPasswordForEmail(String(form.get("email")), {
          redirectTo: `${window.location.origin}/redefinir-senha`,
        });
        setNotice(
          "Se o e-mail estiver cadastrado, você receberá as instruções para redefinir sua senha.",
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: loginEmail(String(form.get("email"))),
          password: String(form.get("password")),
        });
        if (error)
          throw new Error(
            "CPF, e-mail ou senha inválidos. Confira e tente novamente.",
          );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Logo />
        <div>
          <span className="eyebrow light">APRENDER. APLICAR. EVOLUIR.</span>
          <h1>
            Conhecimento que
            <br />
            move a nossa
            <br />
            <em>gente.</em>
          </h1>
          <p>
            Um espaço para desenvolver habilidades,
            <br />
            compartilhar conhecimento e ir mais longe.
          </p>
          <div className="story-features">
            <span>
              <BookOpen size={19} /> Treinamentos em um só lugar
            </span>
            <span>
              <ChartNoAxesCombined size={19} /> Evolução a cada etapa
            </span>
          </div>
        </div>
        <footer>
          Juntos, construímos o próximo passo.{" "}
          <span>© {new Date().getFullYear()} Cifra Academy</span>
        </footer>
      </section>
      <section className="auth-form">
        <div className="auth-card">
          <span className="eyebrow">PLATAFORMA DE TREINAMENTOS</span>
          <h2>
            {recovery
              ? "Sua nova senha"
              : reset
                ? "Vamos recuperar seu acesso"
                : "Bom ter você por aqui."}
          </h2>
          <p>
            {recovery
              ? "Escolha uma senha com pelo menos 12 caracteres."
              : reset
                ? "Para acesso por CPF, procure o administrador. Contas antigas podem recuperar pelo e-mail."
                : "Acesse sua conta e continue sua jornada de desenvolvimento."}
          </p>
          {!configured && (
            <div className="notice">
              Ambiente aguardando configuração. O acesso será liberado após a
              conexão com o Supabase.
            </div>
          )}
          <form onSubmit={submit}>
            {!recovery && (
              <label>
                CPF ou e-mail
                <input
                  name="email"
                  type="text"
                  placeholder="CPF sem pontuação"
                  autoComplete="username"
                  required
                />
              </label>
            )}
            {(!reset || recovery) && (
              <label>
                {recovery ? "Nova senha" : "Senha"}
                <input
                  name="password"
                  type="password"
                  placeholder="Sua senha"
                  autoComplete={recovery ? "new-password" : "current-password"}
                  minLength={recovery ? 12 : undefined}
                  maxLength={128}
                  required
                />
              </label>
            )}
            <ErrorNotice message={error} />
            {notice && (
              <div className="success" role="status">
                {notice}
              </div>
            )}
            <Button className="w-full" disabled={busy || !configured}>
              {busy
                ? "Aguarde..."
                : recovery
                  ? "Salvar nova senha"
                  : reset
                    ? "Enviar instruções"
                    : "Entrar na plataforma"}
              <ArrowRight size={17} />
            </Button>
          </form>
          {!recovery && (
            <button
              className="text-button"
              onClick={() => {
                setReset(!reset);
                setError("");
                setNotice("");
              }}
            >
              {reset ? "Voltar para o login" : "Esqueci minha senha"}
            </button>
          )}
          <div className="auth-security">
            <ShieldCheck size={17} /> Acesso seguro e exclusivo para
            colaboradores
          </div>
        </div>
      </section>
    </div>
  );
}
