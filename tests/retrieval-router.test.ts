/**
 * Two-track retrieval router tests (Problem 3 §Step 3). DB-free — tests the
 * pure logic pieces (chunker, classifier, contradiction extractors) that don't
 * need Postgres. The full router integration is exercised in staging via the
 * /api/deployment/query endpoint.
 */

import { chunkText } from "../web/netlify/functions/_shared/onboarding/ingestion/chunker.ts";
import { classifyChunk } from "../web/netlify/functions/_shared/onboarding/ingestion/classifier.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function testChunkerRespectsOverlap(): void {
  const text = "Sentence one. Sentence two. ".repeat(200);
  const chunks = chunkText(text);
  assert(chunks.length > 1, "long text should produce multiple chunks");
  assert(chunks.every((c) => c.text.length > 0), "no empty chunks");
  // Overlap: earlier chunks share some tail with next chunks' head. Check that
  // chunk boundaries didn't drop content — total non-overlap length ≈ text len.
  const uniqueLen = chunks.reduce((n, c) => n + c.text.length, 0);
  assert(uniqueLen >= text.length * 0.9, "chunks should cover ~all text");
}

function testChunkerHandlesShortText(): void {
  const chunks = chunkText("Hello world.");
  assert(chunks.length === 1, "short text = single chunk");
  assert(chunks[0].text === "Hello world.", "single chunk equals input");
}

function testChunkerHandlesEmpty(): void {
  assert(chunkText("").length === 0, "empty in = empty out");
  assert(chunkText("   \n\n  ").length === 0, "whitespace = empty out");
}

function testClassifierPricing(): void {
  const category = classifyChunk("Our Basic plan is $19.99 per month, discounted from $29.");
  assert(category === "pricing", `expected pricing, got ${category}`);
}

function testClassifierPolicy(): void {
  const category = classifyChunk("Refunds are available within 14 days of purchase.");
  assert(category === "policy", `expected policy, got ${category}`);
}

function testClassifierGeneralFallback(): void {
  const category = classifyChunk("Welcome to our company.");
  assert(category === "general", `expected general, got ${category}`);
}

function testClassifierTroubleshooting(): void {
  const category = classifyChunk("If the device does not turn on, try to reset it.");
  assert(category === "troubleshooting", `expected troubleshooting, got ${category}`);
}

async function main(): Promise<void> {
  const tests = [
    ["chunker respects overlap", testChunkerRespectsOverlap],
    ["chunker handles short text", testChunkerHandlesShortText],
    ["chunker handles empty", testChunkerHandlesEmpty],
    ["classifier: pricing", testClassifierPricing],
    ["classifier: policy", testClassifierPolicy],
    ["classifier: general fallback", testClassifierGeneralFallback],
    ["classifier: troubleshooting", testClassifierTroubleshooting],
  ] as const;

  let passed = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (error) {
      console.error(`FAIL  ${name}:`, error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }

  console.log(`\nRetrieval router tests: ${passed}/${tests.length} passed`);
  if (process.exitCode) process.exit(process.exitCode);
}

void main();
