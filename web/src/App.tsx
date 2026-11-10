import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router";
import { AppShell } from "./components/layout/AppShell";
import { Button, ErrorState, PageLoader } from "./components/ui";
import { useAuth } from "./context/AuthContext";
import { allowed, HOME } from "./lib/roles";
import { NotFoundPage, ProfilePage, SearchPage, SettingsPage } from "./pages/AccountPages";
import { ForgotPasswordPage, LoginPage, ResetPasswordPage } from "./pages/AuthPages";

const WardOverviewPage = lazy(() => import("./pages/WardOverviewPage"));
const PatientsPage = lazy(() => import("./pages/PatientsPage"));
const PatientDetailPage = lazy(() => import("./pages/PatientDetailPage"));
const LiveMonitoringPage = lazy(() => import("./pages/LiveMonitoringPage"));
const AlarmsPage = lazy(() => import("./pages/AlarmsPage"));
const DevicesPage = lazy(() => import("./pages/DevicesPage").then((m) => ({ default: m.DevicesPage })));
const DeviceDetailPage = lazy(() => import("./pages/DevicesPage").then((m) => ({ default: m.DeviceDetailPage })));
const MaintenancePage = lazy(() => import("./pages/MaintenancePage"));
const ThresholdsPage = lazy(() => import("./pages/ThresholdsPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const TeamPage = lazy(() => import("./pages/TeamPage"));
const SimulationPage = lazy(() => import("./pages/SimulationPage"));

function RequireAuth() {
  const { session, loading, profile, profileError, recovery, signOut } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoader label="Starting ACME Clinical…" />;
  if (recovery) return <Navigate to="/reset-password" replace />;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (profileError || !profile)
    return (
      <div className="mx-auto max-w-lg p-10">
        <ErrorState error={profileError ?? new Error("Profile not found")} />
        <div className="mt-4 text-center"><Button variant="secondary" onClick={() => signOut()}>Sign out</Button></div>
      </div>
    );
  return <AppShell />;
}

function Guard({ path, children }: { path: string; children: ReactNode }) {
  const { profile } = useAuth();
  return allowed(path, profile?.role) ? <>{children}</> : <NotFoundPage forbidden />;
}

function Home() {
  const { profile } = useAuth();
  return <Navigate to={profile ? HOME[profile.role] : "/login"} replace />;
}

const page = (path: string, el: ReactNode) => (
  <Guard path={path}>
    <Suspense fallback={<PageLoader />}>{el}</Suspense>
  </Guard>
);

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Outlet />,
        children: [
          { index: true, element: <Home /> },
          { path: "wards", element: page("/wards", <WardOverviewPage />) },
          { path: "patients", element: page("/patients", <PatientsPage />) },
          { path: "patients/:id", element: page("/patients", <PatientDetailPage />) },
          { path: "monitoring", element: page("/monitoring", <LiveMonitoringPage />) },
          { path: "alarms", element: page("/alarms", <AlarmsPage />) },
          { path: "thresholds", element: page("/thresholds", <ThresholdsPage />) },
          { path: "devices", element: page("/devices", <DevicesPage />) },
          { path: "devices/:id", element: page("/devices", <DeviceDetailPage />) },
          { path: "maintenance", element: page("/maintenance", <MaintenancePage />) },
          { path: "reports", element: page("/reports", <ReportsPage />) },
          { path: "team", element: page("/team", <TeamPage />) },
          { path: "simulation", element: page("/simulation", <SimulationPage />) },
          { path: "profile", element: <ProfilePage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "search", element: <SearchPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
