import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { NavIcon } from "../ui/NavIcon";
import { NotificationBell } from "./NotificationBell";

interface TopNavProps {
  title: string;
  menuOpen: boolean;
  onMenuClick: () => void;
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function TopNav({ title, menuOpen, onMenuClick }: TopNavProps) {
  const { user, workspace, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpenAccount, setMenuOpenAccount] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpenAccount(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
      setMenuOpenAccount(false);
    }
  }

  return (
    <header className="topnav">
      <div className="topnav__left">
        <button
          type="button"
          className="topnav__menu"
          onClick={onMenuClick}
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
        >
          <NavIcon name="menu" />
        </button>
        <div>
          <p className="topnav__eyebrow">{workspace?.name ?? "Workspace"}</p>
          <h2 className="topnav__title">{title}</h2>
        </div>
      </div>

      <div className="topnav__right">
        <Link
          to="/app/conversations"
          className="topnav__search"
          aria-label="Search conversations"
        >
          <NavIcon name="search" />
          <span>Search conversations, leads…</span>
        </Link>
        <NotificationBell />

        <div className="topnav__account" ref={menuRef}>
          <button
            type="button"
            className="topnav__avatar"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={menuOpenAccount}
            onClick={() => setMenuOpenAccount((value) => !value)}
          >
            {user ? initials(user.name) : "?"}
          </button>

          {menuOpenAccount ? (
            <div className="topnav__dropdown" role="menu">
              <p className="topnav__dropdown-name">{user?.name}</p>
              <p className="topnav__dropdown-email">{user?.email}</p>
              <button
                type="button"
                className="topnav__dropdown-action"
                role="menuitem"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
              >
                {loggingOut ? "Signing out…" : "Log out"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
