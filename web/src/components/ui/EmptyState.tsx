import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon = "◇",
}: EmptyStateProps) {
  return (
    <div className="ux-state ux-state--empty" role="status">
      <span className="ux-state__icon" aria-hidden="true">
        {icon}
      </span>
      <h3 className="ux-state__title">{title}</h3>
      {description ? <p className="ux-state__description">{description}</p> : null}
      {action ? <div className="ux-state__action">{action}</div> : null}
    </div>
  );
}
