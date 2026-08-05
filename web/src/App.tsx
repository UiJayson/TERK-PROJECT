import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { GuestRoute } from "./auth/GuestRoute";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppShell } from "./components/layout/AppShell";
import { HomePage } from "./pages/HomePage";

// Route-level code splitting: the landing page stays in the entry chunk for
// instant first paint; every other page (and recharts, which only analytics
// pulls in) loads on navigation.
const EmbedPage = lazy(() => import("./pages/EmbedPage").then((m) => ({ default: m.EmbedPage })));
const ForgotPasswordPage = lazy(() => import("./pages/auth/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage })));
const LoginPage = lazy(() => import("./pages/auth/LoginPage").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import("./pages/auth/RegisterPage").then((m) => ({ default: m.RegisterPage })));
const ResetPasswordPage = lazy(() => import("./pages/auth/ResetPasswordPage").then((m) => ({ default: m.ResetPasswordPage })));
const AgentsPage = lazy(() => import("./pages/dashboard/AgentsPage").then((m) => ({ default: m.AgentsPage })));
const AnalyticsPage = lazy(() => import("./pages/dashboard/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })));
const BillingPage = lazy(() => import("./pages/dashboard/BillingPage").then((m) => ({ default: m.BillingPage })));
const ChannelsPage = lazy(() => import("./pages/dashboard/ChannelsPage").then((m) => ({ default: m.ChannelsPage })));
const ConversationsPage = lazy(() => import("./pages/dashboard/ConversationsPage").then((m) => ({ default: m.ConversationsPage })));
const DashboardHome = lazy(() => import("./pages/dashboard/DashboardHome").then((m) => ({ default: m.DashboardHome })));
const IntegrationsPage = lazy(() => import("./pages/dashboard/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })));
const KnowledgeBasePage = lazy(() => import("./pages/dashboard/KnowledgeBasePage").then((m) => ({ default: m.KnowledgeBasePage })));
const ModulesPage = lazy(() => import("./pages/dashboard/ModulesPage").then((m) => ({ default: m.ModulesPage })));
const OnboardingPage = lazy(() => import("./pages/dashboard/OnboardingPage").then((m) => ({ default: m.OnboardingPage })));
const ValidationPage = lazy(() => import("./pages/dashboard/ValidationPage").then((m) => ({ default: m.ValidationPage })));
const DeploymentPage = lazy(() => import("./pages/dashboard/DeploymentPage").then((m) => ({ default: m.DeploymentPage })));
const LeadsPage = lazy(() => import("./pages/dashboard/LeadsPage").then((m) => ({ default: m.LeadsPage })));
const SettingsPage = lazy(() => import("./pages/dashboard/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const SystemHealthPage = lazy(() => import("./pages/dashboard/SystemHealthPage").then((m) => ({ default: m.SystemHealthPage })));
const AdminHealthPage = lazy(() => import("./pages/dashboard/AdminHealthPage").then((m) => ({ default: m.AdminHealthPage })));

function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/embed/:publicKey" element={<EmbedPage />} />
            <Route path="/admin" element={<Navigate to="/app/knowledge" replace />} />

            <Route element={<GuestRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route path="/app" element={<AppShell />}>
                <Route index element={<DashboardHome />} />
                <Route path="agents" element={<AgentsPage />} />
                <Route path="conversations" element={<ConversationsPage />} />
                <Route path="knowledge" element={<KnowledgeBasePage />} />
                <Route path="leads" element={<LeadsPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="integrations" element={<IntegrationsPage />} />
                <Route path="channels" element={<ChannelsPage />} />
                <Route path="modules" element={<ModulesPage />} />
                <Route path="onboarding" element={<OnboardingPage />} />
                <Route path="validation" element={<ValidationPage />} />
                <Route path="deployment" element={<DeploymentPage />} />
                <Route path="billing" element={<BillingPage />} />
                <Route path="system-health" element={<SystemHealthPage />} />
                <Route path="admin/health" element={<AdminHealthPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Route>

            <Route path="/dashboard" element={<Navigate to="/app" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
