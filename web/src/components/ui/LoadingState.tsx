interface LoadingStateProps {
  label?: string;
  compact?: boolean;
}

export function LoadingState({
  label = "Loading…",
  compact = false,
}: LoadingStateProps) {
  return (
    <div
      className={`ux-state ux-state--loading ${compact ? "ux-state--compact" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="ux-spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}
