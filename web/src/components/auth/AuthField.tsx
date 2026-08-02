import { useId, useState, type ReactNode } from "react";

interface AuthFieldProps {
  label: string;
  type?: "text" | "email" | "password";
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  minLength?: number;
  required?: boolean;
  hint?: string;
  icon?: "mail" | "user" | "building";
}

function FieldIcon({ name }: { name: "mail" | "user" | "building" }) {
  const paths: Record<string, ReactNode> = {
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="m4 7 8 6 8-6" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c1.4-3.4 4-5 7-5s5.6 1.6 7 5" />
      </>
    ),
    building: (
      <>
        <rect x="5" y="4" width="14" height="16" rx="1.5" />
        <path d="M9 8h2M13 8h2M9 12h2M13 12h2M10 20v-4h4v4" />
      </>
    ),
  };
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function AuthField({
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  placeholder,
  minLength,
  required,
  hint,
  icon,
}: AuthFieldProps) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && revealed ? "text" : type;

  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={inputType}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        required={required}
      />
      {isPassword ? (
        <button
          type="button"
          className="auth-field__toggle"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? "Hide password" : "Show password"}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
            <circle cx="12" cy="12" r="2.8" />
            {revealed ? <path d="M4 4l16 16" /> : null}
          </svg>
        </button>
      ) : icon ? (
        <span className="auth-field__icon">
          <FieldIcon name={icon} />
        </span>
      ) : null}
      {hint ? <p className="auth-form__hint">{hint}</p> : null}
    </div>
  );
}
