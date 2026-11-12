import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import TopBar from "./components/TopBar.jsx";
import { useI18n } from "./i18n.jsx";
import { NAV_ITEMS } from "./nav.js";
import Login from "./pages/Login.jsx";
import ModuleTree from "./pages/ModuleTree.jsx";
import Placeholder from "./pages/Placeholder.jsx";
import ProjectLayout from "./pages/ProjectLayout.jsx";
import Projects from "./pages/Projects.jsx";

function Shell() {
  return (
    <>
      <TopBar />
      <main className="main">
        <Outlet />
      </main>
    </>
  );
}

export default function App() {
  const { user, ready } = useAuth();
  const { t } = useI18n();
  if (!ready) return <p className="center">{t("common.loading")}</p>;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<Navigate to="modules" replace />} />
          <Route path="modules" element={<ModuleTree />} />
          {NAV_ITEMS.filter((i) => i.key !== "modules").map((i) => (
            <Route key={i.key} path={i.path} element={<Placeholder titleKey={i.labelKey} />} />
          ))}
        </Route>
        <Route path="*" element={<p>{t("common.notFound")}</p>} />
      </Route>
    </Routes>
  );
}
