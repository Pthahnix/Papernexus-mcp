import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import AdmZip from "adm-zip";
import { saveMarkdown, saveMeta, loadMeta } from "../../src/utils/cache.js";
import { paperFetching } from "../../src/tools/paper_fetching.js";
import type { PaperMeta } from "../../src/types.js";

const originalFetch = global.fetch;

/** Build a ZIP buffer containing a single .md file with the given content. */
function buildMdZip(mdContent: string): Buffer {
  const zip = new AdmZip();
  zip.addFile("paper.md", Buffer.from(mdContent, "utf-8"));
  return zip.toBuffer();
}

/**
 * Create a mock fetch that simulates the full MinerU API flow:
 * 1. POST /file-urls/batch → batch_id + upload URL
 * 2. PUT upload URL → 200
 * 3. GET /extract-results/batch/:id → done + zip URL
 * 4. GET zip URL → ZIP with .md
 */
function mockMineruFetch(mdContent: string): typeof global.fetch {
  const zipBuf = buildMdZip(mdContent);
  return (async (url: any, init?: any) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    const method = init?.method?.toUpperCase() ?? "GET";

    // Step 1: batch upload request
    if (urlStr.includes("/file-urls/batch") && method === "POST") {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            batch_id: "mock-batch-123",
            file_urls: ["https://mock-upload.example.com/upload"],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Step 2: file upload PUT
    if (urlStr.includes("mock-upload.example.com") && method === "PUT") {
      return new Response(null, { status: 200 });
    }

    // Step 3: poll for results
    if (urlStr.includes("/extract-results/batch/")) {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            extract_result: [
              { state: "done", full_zip_url: "https://mock-zip.example.com/result.zip" },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Step 4: download ZIP
    if (urlStr.includes("mock-zip.example.com")) {
      return new Response(zipBuf, { status: 200 });
    }

    return new Response(null, { status: 404 });
  }) as typeof global.fetch;
}

describe("paper_fetching", () => {
  let cacheDir: string;
  const originalCache = process.env.DIR_CACHE;
  const originalMineru = process.env.TOKEN_MINERU;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "papernexus-fetching-"));
    process.env.DIR_CACHE = cacheDir;
  });

  afterEach(() => {
    process.env.DIR_CACHE = originalCache;
    process.env.TOKEN_MINERU = originalMineru;
    global.fetch = originalFetch;
    rmSync(cacheDir, { recursive: true, force: true });
  });

  // ── Cache-first behavior ────────────────────────────────

  describe("cache-first strategy", () => {
    it("returns cached markdownPath if markdown already cached", async () => {
      const path = saveMarkdown("Cached Paper", "# cached content");
      const meta: PaperMeta = {
        title: "Cached Paper",
        normalizedTitle: "cached_paper",
        arxivUrl: "https://arxiv.org/abs/2301.00001",
      };

      // Should NOT call fetch at all — cache hit
      let fetchCalled = false;
      global.fetch = async () => {
        fetchCalled = true;
        return new Response(null, { status: 404 });
      };

      const result = await paperFetching(meta);
      assert.equal(result.markdownPath, path);
      assert.equal(fetchCalled, false, "fetch should not be called when cache hit");
    });

    it("skips network when cache already has the paper", async () => {
      // Pre-cache both meta and markdown
      const md = "# Pre-cached Paper\n\nSome content";
      const mdPath = saveMarkdown("Pre Cached", md);
      saveMeta({
        title: "Pre Cached",
        normalizedTitle: "pre_cached",
        arxivId: "2301.00001",
      });

      const result = await paperFetching({
        title: "Pre Cached",
        normalizedTitle: "pre_cached",
        arxivUrl: "https://arxiv.org/abs/2301.00001",
        oaPdfUrl: "https://arxiv.org/pdf/2301.00001",
      });

      assert.equal(result.markdownPath, mdPath);
    });
  });

  // ── arxiv2md path ────────────────────────────────────────

  describe("arxiv2md fallback", () => {
    it("fetches via arxiv2md when arxivUrl is present", async () => {
      const fakeMarkdown = "# Paper via arxiv2md\n\nContent from arxiv2md service";

      global.fetch = async (url: any) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        // arxiv.content POSTs to arxiv2md.org/api/ingest, expects JSON { content }
        if (urlStr.includes("arxiv2md")) {
          return new Response(JSON.stringify({ content: fakeMarkdown }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(null, { status: 404 });
      };

      const result = await paperFetching({
        title: "ArXiv Paper Test",
        normalizedTitle: "arxiv_paper_test",
        arxivUrl: "https://arxiv.org/abs/2301.00001",
      });

      assert.ok(result.markdownPath, "should have markdownPath after arxiv2md fetch");
      const content = readFileSync(result.markdownPath!, "utf-8");
      assert.ok(content.includes("arxiv2md"));
    });

    it("saves meta to cache after successful arxiv2md fetch", async () => {
      global.fetch = async () =>
        new Response(JSON.stringify({ content: "# Markdown" }), { status: 200 });

      const meta: PaperMeta = {
        title: "Meta Save Test",
        normalizedTitle: "meta_save_test",
        arxivUrl: "https://arxiv.org/abs/2301.00001",
        arxivId: "2301.00001",
      };

      await paperFetching(meta);

      const loaded = loadMeta("meta_save_test");
      assert.ok(loaded, "meta should be cached");
      assert.equal(loaded.arxivId, "2301.00001");
      assert.ok(loaded.markdownPath, "cached meta should have markdownPath");
    });
  });

  // ── MinerU PDF path ──────────────────────────────────────

  describe("MinerU PDF fallback", () => {
    it("falls through to MinerU when no arxivUrl but has oaPdfUrl", async () => {
      // This test verifies the fallback chain: no cache → no arxivUrl → try MinerU
      // MinerU requires a complex multi-step API, so we just verify the function
      // doesn't crash and proceeds to step 4 when MinerU returns null
      global.fetch = async () => new Response(null, { status: 404 });

      const result = await paperFetching({
        title: "PDF Only Paper",
        normalizedTitle: "pdf_only_paper",
        oaPdfUrl: "https://example.com/paper.pdf",
      });

      // MinerU will fail (no TOKEN_MINERU, mock returns 404)
      // Should fall through to step 4 gracefully
      assert.equal(result.markdownPath, undefined);
      assert.equal(result.title, "PDF Only Paper");
    });
  });

  // ── No URLs path ─────────────────────────────────────────

  describe("no URLs available", () => {
    it("returns meta without markdownPath when no URLs present", async () => {
      const meta: PaperMeta = {
        title: "No URLs Paper",
        normalizedTitle: "no_urls_paper",
        abstract: "This paper has no fetchable URLs",
      };

      const result = await paperFetching(meta);
      assert.equal(result.markdownPath, undefined);
      assert.equal(result.title, "No URLs Paper");
      assert.equal(result.abstract, "This paper has no fetchable URLs");
    });

    it("still saves meta to cache even when no markdown fetched", async () => {
      await paperFetching({
        title: "Unfetchable Paper",
        normalizedTitle: "unfetchable_paper",
        doi: "10.1234/unfetchable",
      });

      const loaded = loadMeta("unfetchable_paper");
      assert.ok(loaded, "meta should still be cached");
      assert.equal(loaded.doi, "10.1234/unfetchable");
      assert.equal(loaded.markdownPath, undefined);
    });
  });

  // ── Progress callback ────────────────────────────────────

  describe("progress callback", () => {
    it("calls onProgress when fetching via arxivUrl", async () => {
      global.fetch = async () => new Response(null, { status: 404 });

      const messages: string[] = [];
      await paperFetching(
        {
          title: "Progress Test",
          normalizedTitle: "progress_test",
          arxivUrl: "https://arxiv.org/abs/2301.00001",
        },
        async (info) => {
          messages.push(info.message);
        },
      );

      assert.ok(
        messages.some((m) => m.includes("arxiv2md")),
        "should report arxiv2md progress",
      );
    });

    it("calls onProgress when fetching via oaPdfUrl", async () => {
      global.fetch = async () => new Response(null, { status: 404 });

      const messages: string[] = [];
      await paperFetching(
        {
          title: "PDF Progress Test",
          normalizedTitle: "pdf_progress_test",
          oaPdfUrl: "https://example.com/paper.pdf",
        },
        async (info) => {
          messages.push(info.message);
        },
      );

      assert.ok(
        messages.some((m) => m.includes("MinerU")),
        "should report MinerU progress",
      );
    });
  });

  // ── Local PDF path ─────────────────────────────────────

  describe("local PDF via pdfPath", () => {
    it("converts local PDF via MinerU and caches result", async () => {
      process.env.TOKEN_MINERU = "mock-token";

      // Create a fake local PDF file
      const pdfFile = join(cacheDir, "local_paper.pdf");
      writeFileSync(pdfFile, Buffer.from("%PDF-1.4 fake pdf content"));

      const fakeMd = "# Local Paper\n\nConverted from local PDF";
      global.fetch = mockMineruFetch(fakeMd);

      const result = await paperFetching({
        title: "Local PDF Paper",
        normalizedTitle: "local_pdf_paper",
        pdfPath: pdfFile,
      });

      assert.ok(result.markdownPath, "should have markdownPath after local PDF conversion");
      const content = readFileSync(result.markdownPath!, "utf-8");
      assert.ok(content.includes("Local Paper"), "cached markdown should contain converted content");

      // normalizedTitle should be derived from filename
      assert.equal(result.normalizedTitle, "local_paper");

      // Meta should also be cached under the derived normalizedTitle
      const loaded = loadMeta(result.normalizedTitle);
      assert.ok(loaded, "meta should be cached");
      assert.ok(loaded.markdownPath, "cached meta should have markdownPath");
    });

    it("returns meta without markdownPath when local PDF file does not exist", async () => {
      process.env.TOKEN_MINERU = "mock-token";

      const result = await paperFetching({
        title: "Missing PDF Paper",
        normalizedTitle: "missing_pdf_paper",
        pdfPath: "/nonexistent/path/paper.pdf",
      });

      // pdf.content returns null for nonexistent file → falls through to step 5
      assert.equal(result.markdownPath, undefined);
      assert.equal(result.title, "Missing PDF Paper");
    });

    it("pdfPath takes priority over arxivUrl and oaPdfUrl", async () => {
      process.env.TOKEN_MINERU = "mock-token";

      const pdfFile = join(cacheDir, "priority_paper.pdf");
      writeFileSync(pdfFile, Buffer.from("%PDF-1.4 fake"));

      const localMd = "# From Local PDF";
      global.fetch = mockMineruFetch(localMd);

      // Provide all three sources — pdfPath should win
      const result = await paperFetching({
        title: "Priority Test Paper",
        normalizedTitle: "priority_test_paper",
        pdfPath: pdfFile,
        arxivUrl: "https://arxiv.org/abs/2301.99999",
        oaPdfUrl: "https://example.com/paper.pdf",
      });

      assert.ok(result.markdownPath, "should have markdownPath");
      const content = readFileSync(result.markdownPath!, "utf-8");
      assert.ok(
        content.includes("From Local PDF"),
        "content should come from local PDF, not arxiv2md",
      );
    });

    it("calls onProgress when converting local PDF", async () => {
      process.env.TOKEN_MINERU = "mock-token";

      const pdfFile = join(cacheDir, "progress_local.pdf");
      writeFileSync(pdfFile, Buffer.from("%PDF-1.4 fake"));

      global.fetch = mockMineruFetch("# Progress Test");

      const messages: string[] = [];
      await paperFetching(
        {
          title: "Local Progress Test",
          normalizedTitle: "local_progress_test",
          pdfPath: pdfFile,
        },
        async (info) => {
          messages.push(info.message);
        },
      );

      assert.ok(
        messages.some((m) => m.includes("local PDF via MinerU")),
        "should report local PDF progress",
      );
    });
  });

  // ── Simulation: realistic batch workflow ─────────────────

  describe("simulation: batch fetching workflow", () => {
    it("simulates fetching 3 papers with mixed sources (cached, local PDF, arxivUrl)", async () => {
      process.env.TOKEN_MINERU = "mock-token";

      // Paper 1: already cached
      saveMarkdown("Already Cached Paper", "# Already Cached\n\nContent");

      // Paper 2: local PDF
      const localPdf = join(cacheDir, "sim_local.pdf");
      writeFileSync(localPdf, Buffer.from("%PDF-1.4 sim"));

      // Paper 3: has arxivUrl

      const localMd = "# From Local PDF Sim\n\nLocal content";
      const mineruFetch = mockMineruFetch(localMd);

      global.fetch = (async (url: any, init?: any) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        // arxiv2md requests
        if (urlStr.includes("arxiv2md")) {
          return new Response(
            JSON.stringify({ content: "# Fetched from arXiv\n\nNew content" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // Everything else goes to MinerU mock
        return mineruFetch(url, init);
      }) as typeof global.fetch;

      const papers: PaperMeta[] = [
        {
          title: "Already Cached Paper",
          normalizedTitle: "already_cached_paper",
          arxivUrl: "https://arxiv.org/abs/1111.11111",
        },
        {
          title: "Local PDF Sim Paper",
          normalizedTitle: "local_pdf_sim_paper",
          pdfPath: localPdf,
        },
        {
          title: "Fetchable ArXiv Paper",
          normalizedTitle: "fetchable_arxiv_paper",
          arxivUrl: "https://arxiv.org/abs/2222.22222",
        },
      ];

      const results = await Promise.all(papers.map((p) => paperFetching(p)));

      // Paper 1: cached → has path
      assert.ok(results[0].markdownPath, "cached paper should have markdownPath");

      // Paper 2: local PDF → has path with converted content
      assert.ok(results[1].markdownPath, "local PDF paper should have markdownPath");
      const localContent = readFileSync(results[1].markdownPath!, "utf-8");
      assert.ok(localContent.includes("From Local PDF Sim"));

      // Paper 3: fetched via arxiv2md → has path
      assert.ok(results[2].markdownPath, "arxiv paper should have markdownPath");
      const arxivContent = readFileSync(results[2].markdownPath!, "utf-8");
      assert.ok(arxivContent.includes("Fetched from arXiv"));

      // All should have original titles preserved
      assert.equal(results[0].title, "Already Cached Paper");
      assert.equal(results[1].title, "Local PDF Sim Paper");
      assert.equal(results[2].title, "Fetchable ArXiv Paper");
    });
  });
});
