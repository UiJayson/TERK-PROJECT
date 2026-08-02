import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { appNavItems, bottomNavItems } from "../../config/navigation";
import { NavIcon } from "../ui/NavIcon";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";

const COLLAPSE_KEY = "aios_sidebar_collapsed";

function titleForPath(pathname: string): string {
  const match = appNavItems.find((item) =>
    item.path === "/app" ? pathname === "/app" : pathname.startsWith(item.path),
  );
  return match?.label ?? "Dashboard";
}

export function AppShell() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1",
  );

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle("sidebar-open", sidebarOpen);
    return () => document.body.classList.remove("sidebar-open");
  }, [sidebarOpen]);

  function toggleCollapse() {
    setCollapsed((value) => {
      localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1");
      return !value;
    });
  }

  return (
    <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <Sidebar
        open={sidebarOpen}
        collapsed={collapsed}
        onNavigate={() => setSidebarOpen(false)}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={toggleCollapse}
      />
      <div className="app-shell__main">
        <TopNav
          title={titleForPath(location.pathname)}
          menuOpen={sidebarOpen}
          onMenuClick={() => setSidebarOpen((value) => !value)}
        />
        <main id="main-content" className="app-shell__content" tabIndex={-1}>
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Primary">
        {bottomNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/app"}
            className={({ isActive }) =>
              `bottom-nav__link ${isActive ? "is-active" : ""}`
            }
          >
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
