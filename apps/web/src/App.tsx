import { useErrorState } from "./components/Toast";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  NavLink,
  Route,
  Routes,
  Navigate,
  useLocation,
} from "react-router-dom";
import {
  LayoutDashboard,
  BookOpen,
  Users,
  ChartColumn,
  LogOut,
  ArrowUpRight,
  ShieldCheck,
  Menu,
  X,
  GraduationCap,
  CircleHelp,
  BriefcaseBusiness,
} from "lucide-react";
import { api, supabase } from "./lib";
import { Auth } from "./Auth";
import { Logo, ErrorNotice, Loading } from "./components/shared";
import { Button } from "./components/ui/button";
import type { Profile } from "./types";
import { Dashboard, MyCourses, Reports } from "./Overview";
import { Courses, UsersPage } from "./Administration";
import { JobPositions } from "./JobPositions";
const LazyTraining = lazy(() =>
  import("./Training").then((module) => ({ default: module.Training })),
);
function Training() {
  return (
    <Suspense fallback={<Loading />}>
      <LazyTraining />
    </Suspense>
  );
}

export function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useErrorState();
  const [signedIn, setSignedIn] = useState(false);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    let generation = 0;
    let validatedUserId: string | null = null;
    async function refresh(userId: string | null) {
      const run = ++generation;
      setSignedIn(Boolean(userId));
      setError("");
      if (!userId) {
        validatedUserId = null;
        setProfile(null);
        setLoading(false);
        return;
      }
      // Revalidate the same session in the background without unmounting forms.
      setLoading(validatedUserId !== userId);
      try {
        const p = await api<Profile>("/me");
        if (alive && run === generation) {
          validatedUserId = userId;
          setProfile(p);
        }
      } catch (e) {
        if (alive && run === generation) {
          validatedUserId = null;
          setError((e as Error).message);
          setProfile(null);
        }
      } finally {
        if (alive && run === generation) setLoading(false);
      }
    }
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      // Run outside the Auth callback lock before calling getSession through api().
      setTimeout(() => {
        if (alive) void refresh(session?.user.id ?? null);
      }, 0);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  if (location.pathname === "/redefinir-senha") return <Auth recovery />;
  if (loading) return <Loading />;
  if (!signedIn) return <Auth />;
  if (!profile)
    return (
      <div className="access-error">
        <Logo />
        <ErrorNotice message={error} />
        <Button onClick={() => void supabase?.auth.signOut()}>
          Voltar para o login
        </Button>
      </div>
    );
  const admin = profile.role === "admin";
  const nav = admin
    ? [
        { to: "/", icon: LayoutDashboard, label: "Visão geral" },
        { to: "/cursos", icon: BookOpen, label: "Cursos" },
        { to: "/usuarios", icon: Users, label: "Usuários" },
        { to: "/cargos", icon: BriefcaseBusiness, label: "Cargos" },
        { to: "/relatorios", icon: ChartColumn, label: "Relatórios" },
      ]
    : [
        { to: "/meus-cursos", icon: BookOpen, label: "Meus treinamentos" },
        { to: "/historico", icon: GraduationCap, label: "Meu histórico" },
      ];
  return (
    <div className="app-shell">
      {open && (
        <button
          className="sidebar-backdrop"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`sidebar ${open ? "is-open" : ""}`}>
        <Logo />
        <button
          className="mobile-close"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
        >
          <X />
        </button>
        <span className="nav-caption">PRINCIPAL</span>
        <nav>
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}>
              <item.icon size={19} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-icon">
            <GraduationCap size={24} />
          </span>
          <strong>Crescer é um processo.</strong>
          <p>Cada aprendizado abre novas possibilidades.</p>
          <span>
            Um passo de cada vez <ArrowUpRight size={15} />
          </span>
        </div>
        <div className="sidebar-bottom">
          <ShieldCheck size={16} />
          <span>Ambiente corporativo seguro</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu"
              aria-label="Abrir menu"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
            <span className="breadcrumb">
              Cifra Academy <span>/</span> Desenvolvimento
            </span>
          </div>
          <div className="profile">
            <span className="avatar">
              {(profile.name || profile.email).slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{profile.name || "Colaborador"}</strong>
              <small>
                {profile.is_supreme
                  ? "Conta suprema"
                  : admin
                    ? "Administrador"
                    : "Usuário"}
              </small>
            </div>
            <Button
              variant="ghost"
              size="icon"
              title="Sair"
              aria-label="Sair"
              onClick={() => void supabase?.auth.signOut()}
            >
              <LogOut size={17} />
            </Button>
          </div>
        </header>
        <main>
          <Routes>
            <Route
              path="/"
              element={
                admin ? (
                  <Dashboard admin name={profile.name} />
                ) : (
                  <Navigate to="/meus-cursos" replace />
                )
              }
            />
            {admin ? (
              <>
                <Route path="/cursos" element={<Courses />} />
                <Route
                  path="/usuarios"
                  element={<UsersPage supreme={Boolean(profile.is_supreme)} />}
                />
                <Route path="/cargos" element={<JobPositions />} />
                <Route
                  path="/gerentes"
                  element={<Navigate to="/usuarios" replace />}
                />
                <Route path="/relatorios" element={<Reports />} />
              </>
            ) : (
              <>
                <Route path="/meus-cursos" element={<MyCourses />} />
                <Route path="/historico" element={<MyCourses history />} />
                <Route path="/treinamento/:id" element={<Training />} />
              </>
            )}
            <Route
              path="*"
              element={<Navigate to={admin ? "/" : "/meus-cursos"} replace />}
            />
          </Routes>
        </main>
        <footer className="page-footer">
          <span>
            © {new Date().getFullYear()} Cifra Academy · Desenvolvimento
            contínuo
          </span>
          <span>
            <CircleHelp size={14} /> Precisa de ajuda? Procure seu
            administrador.
          </span>
        </footer>
      </div>
    </div>
  );
}
