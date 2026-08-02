interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div className="ux-error" role="alert" aria-live="assertive">
      <div className="ux-error__content">
        <span className="ux-error__icon" aria-hidden="true">
          !
        </span>
        <p>{message}</p>
      </div>
      {onRetry ? (
        <button type="button" className="ux-error__retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
