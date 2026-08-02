import { Navigate, Outlet } from "react-router-dom";
import { LoadingState } from "../components/ui/LoadingState";
import { useAuth } from "./AuthContext";

export function GuestRoute() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-loading">
        <LoadingState label="Loading…" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/app" replace />;
  }

  return <Outlet />;
}
