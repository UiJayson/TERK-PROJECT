/** Human-like pause before sending a reply: min(3000, max(800, length * 40)) ms */
export function calculateHumanDelay(textLength: number): number {
  return Math.min(3000, Math.max(800, textLength * 40));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForHumanDelay(text: string): Promise<number> {
  const delayMs = calculateHumanDelay(text.length);
  await sleep(delayMs);
  return delayMs;
}
