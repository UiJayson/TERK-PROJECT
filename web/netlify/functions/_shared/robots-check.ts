const ROBOTS_CACHE = new Map<string, { fetchedAt: number; rules: string[] }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function parseRobotsTxt(text: string, userAgent = "*"): string[] {
  const lines = text.split(/\r?\n/);
  const groups: Array<{ agents: string[]; disallows: string[] }> = [];
  let current: { agents: string[]; disallows: string[] } | null = null;

  for (const raw of lines) {
    const line = raw.split("#")[0]?.trim() ?? "";
    if (!line) continue;

    const [directive, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const key = directive.toLowerCase();

    if (key === "user-agent") {
      if (!current || current.disallows.length > 0) {
        current = { agents: [], disallows: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (key === "disallow" && current) {
      if (value) current.disallows.push(value);
    }
  }

  const matching =
    groups.find((group) => group.agents.includes(userAgent.toLowerCase())) ??
    groups.find((group) => group.agents.includes("*"));

  return matching?.disallows ?? [];
}

function pathMatchesRule(path: string, rule: string): boolean {
  if (!rule) return false;
  if (rule === "/") return true;
  return path.startsWith(rule);
}

export async function isAllowedByRobotsTxt(targetUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  const robotsUrl = `${parsed.origin}/robots.txt`;
  const cached = ROBOTS_CACHE.get(robotsUrl);
  const now = Date.now();

  let disallows: string[];
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    disallows = cached.rules;
  } else {
    try {
      const response = await fetch(robotsUrl, {
        headers: { "User-Agent": "AIBusinessOS-MarketingBot/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        return true;
      }
      const text = await response.text();
      disallows = parseRobotsTxt(text);
      ROBOTS_CACHE.set(robotsUrl, { fetchedAt: now, rules: disallows });
    } catch {
      return true;
    }
  }

  const path = parsed.pathname || "/";
  return !disallows.some((rule) => pathMatchesRule(path, rule));
}
