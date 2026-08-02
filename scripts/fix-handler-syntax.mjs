import fs from "node:fs";
import path from "node:path";

const root = path.resolve("web/netlify/functions");

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;

    const source = fs.readFileSync(fullPath, "utf8");
    const updated = source.replace(
      /async function handler\s*\(([^)]*)\)\s*=>\s*\{/g,
      "async function handler($1) {",
    );
    if (updated !== source) {
      fs.writeFileSync(fullPath, updated);
      console.log("fixed", fullPath);
    }
  }
}

walk(root);
