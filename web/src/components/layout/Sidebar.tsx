import { NavLink, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { navSections } from "../../config/navigation";
import { NavIcon } from "../ui/NavIcon";

interface SidebarProps {
  open: boolean;
  collapsed: boolean;
  onNavigate: () => void;
  onClose: () => void;
  onToggleCollapse: () => void;
}

export function Sidebar({
  open,
  collapsed,
  onNavigate,
  onClose,
  onToggleCollapse,
}: SidebarProps) {
  const { workspace, role } = useAuth();

  const sections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.roles || (role && item.roles.includes(role)),
      ),
    }))
    .filter((section) => section.items.length > 0);

  const showUpgrade = role === "owner" || role === "admin";

  return (
    <>
      <div
        className={`sidebar-backdrop ${open ? "is-visible" : ""}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`sidebar ${open ? "is-open" : ""}`}
        aria-label="Main navigation"
        id="app-sidebar"
      >
        <div className="sidebar__brand">
          <span className="sidebar__mark" aria-hidden="true">
            H
          </span>
          {!collapsed ? (
            <div>
              <p className="sidebar__product">Harbor AI</p>
              <p className="sidebar__workspace">{workspace?.name ?? "Workspace"}</p>
            </div>
          ) : null}
          <button
            type="button"
            className="sidebar__collapse"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <NavIcon name={collapsed ? "expand" : "collapse"} />
          </button>
        </div>

        <nav className="sidebar__nav" aria-label="Workspace">
          {sections.map((section) => (
            <div key={section.label} className="sidebar__section">
              <p className="sidebar__section-label">{section.label}</p>
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === "/app"}
                  className={({ isActive }) =>
                    `sidebar__link ${isActive ? "is-active" : ""}`
                  }
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                >
                  <NavIcon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {showUpgrade ? (
          <Link to="/app/billing" className="sidebar__upgrade" onClick={onNavigate}>
            <p className="sidebar__upgrade-title">Upgrade Harbor AI</p>
            <p className="sidebar__upgrade-note">
              Unlock more messages and every agent
            </p>
          </Link>
        ) : null}
      </aside>
    </>
  );
}
