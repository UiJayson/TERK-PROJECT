import { getStoredToken } from "../auth/api";

export interface ModuleManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  requiredKernelVersion: string;
  capabilities: string[];
  status: "available" | "coming_soon";
}

export interface InstalledModule {
  workspaceId: string;
  moduleId: string;
  version: string;
  installedAt: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `Request failed (${response.status})`);
  }
  return data as T;
}

export async function fetchAvailableModules(): Promise<ModuleManifest[]> {
  const data = await request<{ modules: ModuleManifest[] }>("/api/modules/available");
  return data.modules;
}

export async function fetchInstalledModules(): Promise<InstalledModule[]> {
  const data = await request<{ installed: InstalledModule[] }>("/api/modules/installed");
  return data.installed;
}

export async function installModule(moduleId: string): Promise<InstalledModule[]> {
  const data = await request<{ installed: InstalledModule[] }>("/api/modules/install", {
    method: "POST",
    body: JSON.stringify({ moduleId }),
  });
  return data.installed;
}

export async function uninstallModule(moduleId: string): Promise<InstalledModule[]> {
  const data = await request<{ installed: InstalledModule[] }>("/api/modules/uninstall", {
    method: "POST",
    body: JSON.stringify({ moduleId }),
  });
  return data.installed;
}
