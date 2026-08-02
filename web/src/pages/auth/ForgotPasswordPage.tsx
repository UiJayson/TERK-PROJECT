import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { requestPasswordReset } from "../../auth/api";
import { AuthField } from "../../components/auth/AuthField";
import { AuthLayout } from "../../components/auth/AuthLayout";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [resetUrl, setResetUrl] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setResetUrl(undefined);
    setLoading(true);

    try {
      const result = await requestPasswordReset(email);
      setMessage(result.message);
      setResetUrl(result.resetUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Account recovery"
      title="Reset your password"
      subtitle={
        <>
          Remembered it? <Link to="/login">Back to sign in</Link>
        </>
      }
      navLink={{ label: "Sign in", to: "/login" }}
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

        {error ? <p className="auth-form__error">{error}</p> : null}
        {message ? <p className="auth-form__success">{message}</p> : null}
        {resetUrl ? (
          <p className="auth-form__success">
            Dev reset link:{" "}
            <Link to={new URL(resetUrl).pathname + new URL(resetUrl).search}>
              Reset password
            </Link>
          </p>
        ) : null}

        <div className="auth-form__actions">
          <span />
          <button type="submit" className="auth-form__submit" disabled={loading}>
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
