import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAvailableModules,
  fetchInstalledModules,
  installModule,
  uninstallModule,
  type InstalledModule,
  type ModuleManifest,
} from "../../api/modules";
import { Card } from "../../components/ui/Card";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";

export function ModulesPage() {
  const [available, setAvailable] = useState<ModuleManifest[]>([]);
  const [installed, setInstalled] = useState<InstalledModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [availableResult, installedResult] = await Promise.all([
        fetchAvailableModules(),
        fetchInstalledModules(),
      ]);
      setAvailable(availableResult);
      setInstalled(installedResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load modules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const installedIds = useMemo(
    () => new Set(installed.map((row) => row.moduleId)),
    [installed],
  );

  async function toggle(moduleId: string, isInstalled: boolean) {
    setError("");
    setPending(moduleId);
    try {
      const rows = isInstalled ? await uninstallModule(moduleId) : await installModule(moduleId);
      setInstalled(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(null);
    }
  }

  if (loading) {
    return (
      <div className="page-stack">
        <PageHeader
          title="Business modules"
          description="Install industry modules to give your agents new capabilities."
        />
        <LoadingState label="Loading modules…" />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Business modules"
        description="Install industry modules to give your agents new capabilities. Only installed modules add tools and context to your agents."
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <section className="integrations-grid">
        {available.map((mod) => {
          const isInstalled = installedIds.has(mod.id);
          const comingSoon = mod.status === "coming_soon";
          const busy = pending === mod.id;

          return (
            <Card key={mod.id} title={mod.name}>
              <div className="channel-card__header">
                <p className="integrations-copy">{mod.description}</p>
                <span
                  className={`channel-badge channel-badge--${
                    comingSoon ? "disconnected" : isInstalled ? "connected" : "disconnected"
                  }`}
                >
                  {comingSoon ? "Coming soon" : isInstalled ? "Installed" : "Not installed"}
                </span>
              </div>

              <p className="integrations-copy">
                <strong>Capabilities:</strong> {mod.capabilities.join(", ")}
              </p>
              <p className="integrations-copy" style={{ fontSize: "0.85em", opacity: 0.75 }}>
                v{mod.version} · needs kernel ≥ {mod.requiredKernelVersion}
              </p>

              {comingSoon ? null : (
                <button
                  type="button"
                  className={`agent-btn ${isInstalled ? "agent-btn--ghost" : "agent-btn--primary"}`}
                  onClick={() => void toggle(mod.id, isInstalled)}
                  disabled={busy}
                >
                  {busy
                    ? isInstalled
                      ? "Uninstalling…"
                      : "Installing…"
                    : isInstalled
                      ? "Uninstall"
                      : "Install"}
                </button>
              )}
            </Card>
          );
        })}
        {available.length === 0 ? (
          <p className="integrations-copy">No modules registered.</p>
        ) : null}
      </section>
    </div>
  );
}
