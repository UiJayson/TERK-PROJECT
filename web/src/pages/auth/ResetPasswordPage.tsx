import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../../auth/api";
import { AuthField } from "../../components/auth/AuthField";
import { AuthLayout } from "../../components/auth/AuthLayout";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await resetPassword({ token, password });
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout
        eyebrow="Account recovery"
        title="Invalid link"
        subtitle="This password reset link is missing a token."
        navLink={{ label: "Sign in", to: "/login" }}
      >
        <p className="auth-switch">
          <Link to="/forgot-password">Request a new reset link</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="Account recovery"
      title="Set a new password"
      subtitle="Choose a strong password for your account."
      navLink={{ label: "Sign in", to: "/login" }}
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <AuthField
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={8}
          required
        />
        <AuthField
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          minLength={8}
          required
        />

        {error ? <p className="auth-form__error">{error}</p> : null}

        <div className="auth-form__actions">
          <span />
          <button type="submit" className="auth-form__submit" disabled={loading}>
            {loading ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
