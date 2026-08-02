import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { AuthField } from "../../components/auth/AuthField";
import { AuthLayout } from "../../components/auth/AuthLayout";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login({ email, password });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Sign in to your workspace"
      subtitle={
        <>
          New to Harbor AI? <Link to="/register">Create an account</Link>
        </>
      }
      navLink={{ label: "Join", to: "/register" }}
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          icon="mail"
          required
        />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />

        {error ? <p className="auth-form__error">{error}</p> : null}

        <div className="auth-form__actions">
          <Link to="/forgot-password" className="auth-form__ghost">
            Forgot password?
          </Link>
          <button type="submit" className="auth-form__submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
