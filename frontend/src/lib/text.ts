export function decodeHtmlEntities(input: string): string {
  if (!input) return input;
  // Fast path: no entity-looking substrings.
  if (!input.includes("&")) return input;

  // Browser decode (safe: React will still escape on render).
  if (typeof document !== "undefined") {
    const el = document.createElement("textarea");
    el.innerHTML = input;
    return el.value;
  }

  // Non-browser fallback for tests/SSR-like environments.
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

