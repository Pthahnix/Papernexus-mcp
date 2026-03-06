import type { PaperMeta } from "../types.js";
import { normTitle } from "../utils/misc.js";
import * as ss from "../utils/ss.js";
import * as arxiv from "../utils/arxiv.js";
import * as unpaywall from "../utils/unpaywall.js";

/** Apify Google Scholar scraper raw item shape. */
export interface ApifyScholarItem {
  title?: string;
  link?: string;
  authors?: string;
  year?: string | number;
  citations?: string | number;
  searchMatch?: string;
  documentLink?: string;
}

/** Parse base fields from apify scraper output. */
function parseApifyItem(item: ApifyScholarItem): PaperMeta {
  const title = item.title ?? "";
  const arxivMatch = (item.link ?? "").match(
    /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i,
  );
  const arxivId = arxivMatch ? arxivMatch[1] : undefined;
  const yearMatch = String(item.year ?? "").match(/(\d{4})/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

  return {
    title,
    normalizedTitle: normTitle(title),
    arxivId,
    arxivUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined,
    year,
    authors: item.authors ?? undefined,
    abstract: item.searchMatch ?? undefined,
    citationCount: item.citations != null ? Number(item.citations) : undefined,
    // oaPdfUrl left empty — filled by Semantic Scholar or Unpaywall in enrichMeta
    sourceUrl: item.link ?? undefined,
  };
}

/**
 * Enrich a PaperMeta with data from Semantic Scholar, arXiv, and Unpaywall.
 * This is the core enrichment logic, reused by paper_references.
 */
export async function enrichMeta(meta: PaperMeta): Promise<PaperMeta> {
  // 1. Semantic Scholar
  const ssResult = await ss.query(meta.title);
  if (ssResult) {
    if (!meta.s2Id) meta.s2Id = ssResult.s2Id;
    if (!meta.doi) meta.doi = ssResult.doi;
    if (!meta.arxivId) meta.arxivId = ssResult.arxivId;
    if (!meta.arxivUrl) meta.arxivUrl = ssResult.arxivUrl;
    if (!meta.oaPdfUrl) meta.oaPdfUrl = ssResult.oaPdfUrl;
    if (!meta.year) meta.year = ssResult.year;
    if (!meta.authors) meta.authors = ssResult.authors;
    if (!meta.abstract) meta.abstract = ssResult.abstract;
    if (!meta.citationCount) meta.citationCount = ssResult.citationCount;
    if (!meta.sourceUrl) meta.sourceUrl = ssResult.sourceUrl;
  }

  // 2. If still no arxivUrl, try arXiv API
  if (!meta.arxivUrl) {
    const arxivResult = await arxiv.query(meta.title);
    if (arxivResult?.arxivUrl) {
      meta.arxivId = arxivResult.arxivId;
      meta.arxivUrl = arxivResult.arxivUrl;
      if (!meta.abstract) meta.abstract = arxivResult.abstract;
      if (!meta.authors) meta.authors = arxivResult.authors;
      if (!meta.year) meta.year = arxivResult.year;
    }
  }

  // 3. If has DOI but no oaPdfUrl, try Unpaywall
  if (meta.doi && !meta.oaPdfUrl) {
    const upResult = await unpaywall.query(meta.doi);
    if (upResult?.oaPdfUrl) {
      meta.oaPdfUrl = upResult.oaPdfUrl;
    }
  }

  return meta;
}

/** Exported for testing. */
export { parseApifyItem };

/**
 * paper_searching tool: parse apify item + enrich metadata.
 */
export async function paperSearching(item: ApifyScholarItem): Promise<PaperMeta> {
  const meta = parseApifyItem(item);
  return enrichMeta(meta);
}
