import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { paperSearching } from "./tools/paper_searching.js";
import { paperFetching } from "./tools/paper_fetching.js";
import { paperReferences } from "./tools/paper_references.js";
import { paperReading } from "./tools/paper_reading.js";
import type { ProgressCallback } from "./utils/pdf.js";

const server = new McpServer({
  name: "neocortica-scholar",
  version: "0.1.0",
});

// ── Helper: build progress callback from MCP extra ──────────────────

function makeProgress(extra: any): ProgressCallback {
  const token = extra?._meta?.progressToken;
  return async (info) => {
    if (token !== undefined && info.current !== undefined && info.total !== undefined) {
      await extra.sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress: info.current, total: info.total, message: info.message },
      });
    }
    try { await server.sendLoggingMessage({ level: "info", data: info.message }); } catch {}
  };
}

// ── Tool 1: paper_searching ─────────────────────────────────────────

server.tool(
  "paper_searching",
  "Enrich a raw Google Scholar result with metadata from Semantic Scholar, arXiv, and Unpaywall. " +
  "Input: single item from apify google_scholar_scraper. Output: PaperMeta with abstract, arxivUrl, oaPdfUrl.",
  {
    title: z.string().optional().describe("Paper title"),
    link: z.string().optional().describe("Source URL from Scholar"),
    authors: z.string().optional().describe("Author string"),
    year: z.union([z.string(), z.number()]).optional().describe("Publication year"),
    citations: z.union([z.string(), z.number()]).optional().describe("Citation count"),
    searchMatch: z.string().optional().describe("Snippet / abstract from Scholar"),
    documentLink: z.string().optional().describe("Direct PDF link from Scholar"),
  },
  async (args) => {
    try {
      const result = await paperSearching(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      return { isError: true, content: [{ type: "text" as const, text: `paper_searching failed: ${e.message}` }] };
    }
  },
);

// ── Tool 2: paper_fetching ──────────────────────────────────────────

server.tool(
  "paper_fetching",
  "Fetch full paper as markdown. Cache-first: checks local cache by normalizedTitle before network. " +
  "Tries arxiv2md for arxivUrl, MinerU for oaPdfUrl. When pdfPath is set, title and normalizedTitle " +
  "are auto-derived from the filename. Returns PaperMeta with markdownPath.",
  {
    title: z.string().optional().describe("Paper title (auto-derived from pdfPath filename if omitted)"),
    normalizedTitle: z.string().optional().describe("Normalized title for cache lookup (auto-derived from pdfPath filename if omitted)"),
    arxivId: z.string().optional(),
    doi: z.string().optional(),
    s2Id: z.string().optional(),
    abstract: z.string().optional(),
    arxivUrl: z.string().optional().describe("arXiv abs URL"),
    oaPdfUrl: z.string().optional().describe("Open access PDF URL"),
    pdfPath: z.string().optional().describe("Absolute local path to a PDF file"),
    year: z.number().optional(),
    authors: z.string().optional(),
    citationCount: z.number().optional(),
    sourceUrl: z.string().optional(),
  },
  async (args, extra: any) => {
    try {
      const meta = { ...args, title: args.title ?? "", normalizedTitle: args.normalizedTitle ?? "" };
      const result = await paperFetching(meta, makeProgress(extra));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      return { isError: true, content: [{ type: "text" as const, text: `paper_fetching failed: ${e.message}` }] };
    }
  },
);

// ── Tool 3: paper_references ────────────────────────────────────────

server.tool(
  "paper_references",
  "Extract cited references from a paper's markdown file, then enrich each with metadata " +
  "from Semantic Scholar, arXiv, and Unpaywall. Returns PaperMeta[] for all found references.",
  {
    markdownPath: z.string().describe("Absolute path to the paper's cached markdown file"),
  },
  async ({ markdownPath }) => {
    try {
      const results = await paperReferences(markdownPath);
      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    } catch (e: any) {
      return { isError: true, content: [{ type: "text" as const, text: `paper_references failed: ${e.message}` }] };
    }
  },
);

// ── Tool 4: paper_reading (stub) ────────────────────────────────────

server.tool(
  "paper_reading",
  "AI-powered paper reader (NOT YET IMPLEMENTED). Will read paper markdown and return structured summary.",
  {
    markdownPath: z.string().describe("Absolute path to the paper's cached markdown file"),
    instructions: z.string().optional().describe("Optional reading focus instructions"),
  },
  async ({ markdownPath, instructions }) => {
    try {
      const result = await paperReading(markdownPath, instructions);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      return { isError: true, content: [{ type: "text" as const, text: `paper_reading failed: ${e.message}` }] };
    }
  },
);

// ── Start ───────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
