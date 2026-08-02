import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface AuthLayoutProps {
  eyebrow?: string;
  title: string;
  subtitle: ReactNode;
  navLink?: { label: string; to: string };
  children: ReactNode;
}

/**
 * Split-panel auth shell: white form panel on the left, gradient panel with an
 * organic blob edge on the right. The blob is an SVG path filled with the
 * surface color so the curve reads as one fluid edge in both themes.
 */
export function AuthLayout({
  eyebrow = "Harbor AI",
  title,
  subtitle,
  navLink,
  children,
}: AuthLayoutProps) {
  return (
    <div className="auth-split">
      <div className="auth-split__card">
        <div className="auth-split__left">
          <nav className="auth-split__nav" aria-label="Auth navigation">
            <Link to="/" className="auth-split__brand">
              <span className="auth-split__brand-mark" aria-hidden="true">
                H
              </span>
              Harbor AI
            </Link>
            <div className="auth-split__links">
              <Link to="/">Home</Link>
              {navLink ? <Link to={navLink.to}>{navLink.label}</Link> : null}
            </div>
          </nav>

          <div className="auth-split__form">
            <p className="auth-split__eyebrow">{eyebrow}</p>
            <h1 className="auth-split__title">
              {title}
              <span className="auth-split__title-dot">.</span>
            </h1>
            <p className="auth-split__subtitle">{subtitle}</p>
            {children}
          </div>

          <p className="auth-split__footer">
            <Link to="/">Back to site</Link>
          </p>
        </div>

        <div className="auth-split__right" aria-hidden="true">
          <svg
            className="auth-split__blob"
            viewBox="0 0 420 840"
            preserveAspectRatio="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M0,0 L96,0
                 C34,84 148,132 118,224
                 C90,310 10,342 44,438
                 C80,540 170,568 138,668
                 C116,738 60,772 84,840
                 L0,840 Z"
              fill="var(--surface)"
            />
            <path
              d="M96,0
                 C34,84 148,132 118,224
                 C90,310 10,342 44,438
                 C80,540 170,568 138,668
                 C116,738 60,772 84,840"
              fill="none"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
