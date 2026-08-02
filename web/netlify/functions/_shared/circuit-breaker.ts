/**
 * Circuit breaker for external providers (AI, payment, messaging).
 *
 * closed    -> requests flow; failures are counted in a rolling window.
 * open      -> after `failureThreshold` failures, requests fail fast for
 *              `openMs` (no provider calls, no timeout stacking).
 * half-open -> after `openMs`, one probe request is allowed through; success
 *              closes the circuit, failure re-opens it.
 *
 * Per function instance (module scope). That is the right blast radius on
 * serverless: an instance that keeps seeing provider timeouts stops hammering
 * the provider, while fresh instances still probe independently.
 */

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  windowMs?: number;
  openMs?: number;
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is open — failing fast`);
    this.name = "CircuitOpenError";
  }
}

type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures: number[] = [];
  private openedAt = 0;
  private probing = false;

  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly openMs: number;

  constructor(
    readonly name: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.windowMs = options.windowMs ?? 30_000;
    this.openMs = options.openMs ?? 60_000;
  }

  getState(): CircuitState {
    if (this.state === "open" && Date.now() - this.openedAt >= this.openMs) {
      this.state = "half-open";
      this.probing = false;
    }
    return this.state;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const state = this.getState();

    if (state === "open") throw new CircuitOpenError(this.name);
    if (state === "half-open") {
      if (this.probing) throw new CircuitOpenError(this.name);
      this.probing = true;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.state = "closed";
    this.failures = [];
    this.probing = false;
  }

  private onFailure(): void {
    const now = Date.now();
    if (this.state === "half-open") {
      this.trip(now);
      return;
    }
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
    this.failures.push(now);
    if (this.failures.length >= this.failureThreshold) {
      this.trip(now);
    }
  }

  private trip(now: number): void {
    this.state = "open";
    this.openedAt = now;
    this.failures = [];
    this.probing = false;
    console.warn(`Circuit breaker "${this.name}" opened for ${this.openMs}ms`);
  }

  /** For tests. */
  reset(): void {
    this.state = "closed";
    this.failures = [];
    this.probing = false;
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  name: string,
  options?: CircuitBreakerOptions,
): CircuitBreaker {
  let breaker = breakers.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker(name, options);
    breakers.set(name, breaker);
  }
  return breaker;
}

/**
 * Bounded concurrency gate. Under a traffic spike, at most `limit` AI calls
 * run at once per instance; the rest queue (FIFO) up to `maxQueue`, beyond
 * which requests are rejected immediately instead of stacking timeouts.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(
    private readonly limit: number,
    private readonly maxQueue = 100,
  ) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      if (this.queue.length >= this.maxQueue) {
        throw new Error("Request queue is full — system is at capacity");
      }
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await operation();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queue.length;
  }
}
