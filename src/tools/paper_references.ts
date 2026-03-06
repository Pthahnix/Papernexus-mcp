import { readFileSync } from "fs";
import type { PaperMeta } from "../types.js";
import { normTitle } from "../utils/misc.js";
import { enrichMeta } from "./paper_searching.js";

/**
 * Extract reference titles from a paper's markdown content.
 * Looks for a References/Bibliography section and parses individual entries.
 */
export function extractReferenceTitles(markdown: string): string[] {
  // Find the references section
  const refMatch = markdown.match(
    /^#{1,3}\s*(?:references|bibliography|works cited)\s*$/im,
  );
  if (!refMatch || refMatch.index === undefined) return [];

  const refSection = markdown.slice(refMatch.index + refMatch[0].length);

  // Stop at next heading (if any)
  const nextHeading = refSection.match(/^#{1,3}\s+/m);
  const content = nextHeading?.index
    ? refSection.slice(0, nextHeading.index)
    : refSection;

  const titles: string[] = [];

  // Strategy 1: numbered references like [1] Author. "Title." or [1] Author. Title.
  const numbered = content.matchAll(
    /\[\d+\]\s*[^.]+?\.\s*(?:"([^"]+?)\."?|([A-Z][^.]{15,}?)\.)/g,
  );
  for (const m of numbered) {
    const title = (m[1] || m[2])?.trim();
    if (title && title.length > 10) titles.push(title);
  }

  // Strategy 2: bullet references like - Author. "Title."
  if (titles.length === 0) {
    const bulleted = content.matchAll(
      /^[-*]\s+[^.]+?\.\s*(?:"([^"]+?)\."?|([A-Z][^.]{15,}?)\.)/gm,
    );
    for (const m of bulleted) {
      const title = (m[1] || m[2])?.trim();
      if (title && title.length > 10) titles.push(title);
    }
  }

  return titles;
}

/**
 * paper_references tool: extract references from markdown, enrich each.
 */
export async function paperReferences(markdownPath: string): Promise<PaperMeta[]> {
  const markdown = readFileSync(markdownPath, "utf-8");
  const titles = extractReferenceTitles(markdown);

  if (titles.length === 0) return [];

  const results: PaperMeta[] = [];

  // Process in batches of 3 to avoid rate limits
  for (let i = 0; i < titles.length; i += 3) {
    const batch = titles.slice(i, i + 3);
    const settled = await Promise.allSettled(
      batch.map((title) =>
        enrichMeta({
          title,
          normalizedTitle: normTitle(title),
        }),
      ),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") results.push(s.value);
    }
  }

  return results;
}
