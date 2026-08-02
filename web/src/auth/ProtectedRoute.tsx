import { Navigate, Outlet, useLocation } from "react-router-dom";
import { LoadingState } from "../components/ui/LoadingState";
import { useAuth } from "./AuthContext";

export function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-loading">
        <LoadingState label="Loading your workspace…" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
