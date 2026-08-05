/**
 * Concrete Kernel surface handed to modules at registration. Wraps the durable
 * event bus and structured logger so modules get a stable, narrow API and can
 * never reach kernel internals or other modules.
 */

import type { Kernel } from "./adapter.ts";
import type { EventType } from "../event-bus.ts";
import { publish, subscribe } from "../event-bus.ts";
import { log } from "../logger.ts";

/**
 * Kernel semver. Bump the minor when adding backward-compatible surface, the
 * major on a breaking change to the {@link Kernel} or {@link IVerticalAdapter}
 * contract. Modules declare `requiredKernelVersion` and are rejected at load if
 * this kernel is older.
 */
export const KERNEL_VERSION = "1.0.0";

let cached: Kernel | null = null;

/** The singleton kernel surface passed to every module's `register()`. */
export function getKernel(): Kernel {
  if (cached) return cached;

  cached = {
    version: KERNEL_VERSION,
    eventBus: {
      async emit(workspaceId, type, payload) {
        await publish(workspaceId, type, payload);
      },
      on(type: EventType, handler) {
        subscribe(type, async (event) => {
          await handler({
            workspaceId: event.workspaceId,
            type: event.type,
            payload: event.payload,
          });
        });
      },
    },
    log: {
      info: (message, meta) => log.info(message, meta ?? {}),
      warn: (message, meta) => log.warn(message, meta ?? {}),
      error: (message, meta) => log.error(message, meta ?? {}),
    },
  };

  return cached;
}
