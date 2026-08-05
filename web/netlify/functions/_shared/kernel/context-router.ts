/**
 * Agent context routing (spec §4). At request time the orchestrator asks the
 * kernel for the combined module context for a tenant. The kernel reads the
 * tenant's installed modules, and for each active module collects its
 * `getAgentSystemPrompt(agent)` and `getCapabilities()`. Modules the tenant has
 * NOT installed never contribute — so the agent can never reference data or
 * actions from an uninstalled vertical.
 */

import type { AgentRole } from "../types.ts";
import { getModule } from "./registry.ts";
import { getInstalledModuleIds } from "./module-store.ts";

export interface ModuleAgentContext {
  /** Ids of modules that contributed to this context. */
  activeModuleIds: string[];
  /** Union of capability slugs across active modules. */
  capabilities: string[];
  /** Combined system-prompt block to inject, or "" if nothing applies. */
  promptBlock: string;
}

/**
 * Build the combined module context for a tenant + agent role. Safe to call on
 * every turn: a tenant with no installed modules yields an empty block, adding
 * nothing to the prompt.
 */
export async function buildModuleAgentContext(
  workspaceId: string,
  agent: AgentRole,
): Promise<ModuleAgentContext> {
  const installed = await getInstalledModuleIds(workspaceId);

  const activeModuleIds: string[] = [];
  const capabilities = new Set<string>();
  const fragments: string[] = [];

  for (const moduleId of installed) {
    const adapter = getModule(moduleId);
    if (!adapter) continue; // installed row for a module no longer registered — skip

    activeModuleIds.push(moduleId);
    for (const capability of adapter.getCapabilities()) capabilities.add(capability);

    const fragment = adapter.getAgentSystemPrompt(agent).trim();
    if (fragment) fragments.push(fragment);
  }

  const promptBlock =
    fragments.length > 0
      ? ["## Installed business modules", ...fragments].join("\n\n")
      : "";

  return {
    activeModuleIds,
    capabilities: [...capabilities],
    promptBlock,
  };
}
