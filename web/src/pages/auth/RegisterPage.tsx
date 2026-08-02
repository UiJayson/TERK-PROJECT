import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { AuthField } from "../../components/auth/AuthField";
import { AuthLayout } from "../../components/auth/AuthLayout";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await register({ name, email, password, companyName });
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Start for free"
      title="Create your workspace"
      subtitle={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
      navLink={{ label: "Sign in", to: "/login" }}
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-form__row">
          <AuthField
            label="Your name"
            value={name}
            onChange={setName}
            autoComplete="name"
            icon="user"
            required
          />
          <AuthField
            label="Company"
            value={companyName}
            onChange={setCompanyName}
            autoComplete="organization"
            icon="building"
            required
          />
        </div>
        <AuthField
          label="Work email"
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
          autoComplete="new-password"
          minLength={8}
          hint="At least 8 characters"
          required
        />

        {error ? <p className="auth-form__error">{error}</p> : null}

        <div className="auth-form__actions">
          <button type="submit" className="auth-form__submit" disabled={loading}>
            {loading ? "Creating workspace…" : "Create account"}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
