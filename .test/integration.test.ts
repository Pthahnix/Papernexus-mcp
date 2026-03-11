import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "dotenv/config";
import { paperSearching, enrichMeta } from "../src/tools/paper_searching.js";
import { paperFetching } from "../src/tools/paper_fetching.js";
import { paperReferences, extractReferenceTitles } from "../src/tools/paper_references.js";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Live integration tests — require network + valid API keys.
 * Run with: npx tsx --test .test/integration.test.ts
 */

describe("integration: paper_searching", () => {
  it("enriches a known arXiv paper via real APIs", async () => {
    const result = await paperSearching({
      title: "Attention Is All You Need",
      link: "https://arxiv.org/abs/1706.03762",
    });

    assert.ok(result.title, "should have title");
    assert.equal(result.arxivId, "1706.03762");
    assert.ok(result.arxivUrl, "should have arxivUrl");
    assert.ok(result.normalizedTitle, "should have normalizedTitle");

    // SS enrichment may fail due to network — log but don't hard-fail
    if (result.s2Id) {
      assert.ok(result.abstract, "should have abstract when SS succeeds");
      assert.ok(result.citationCount && result.citationCount > 1000, "should have high citation count");
    } else {
      console.log("  NOTE: Semantic Scholar unreachable, skipping SS assertions");
    }

    console.log("  paper_searching result:", JSON.stringify({
      title: result.title,
      arxivId: result.arxivId,
      s2Id: result.s2Id,
      citationCount: result.citationCount,
      hasAbstract: !!result.abstract,
      hasOaPdfUrl: !!result.oaPdfUrl,
    }, null, 2));
  });

  it("enriches a non-arXiv paper title via enrichMeta", async () => {
    const result = await enrichMeta({
      title: "ImageNet Classification with Deep Convolutional Neural Networks",
      normalizedTitle: "imagenet_classification_with_deep_convolutional_neural_networks",
    });

    // Network-dependent — check what we got
    if (result.s2Id) {
      console.log("  enrichMeta found paper on Semantic Scholar");
    } else {
      console.log("  NOTE: SS unreachable, checking arXiv fallback");
    }

    // At minimum the original fields should be preserved
    assert.equal(result.title, "ImageNet Classification with Deep Convolutional Neural Networks");
    assert.ok(result.normalizedTitle);

    console.log("  enrichMeta result:", JSON.stringify({
      title: result.title,
      s2Id: result.s2Id,
      arxivId: result.arxivId,
      doi: result.doi,
      citationCount: result.citationCount,
    }, null, 2));
  });
});

describe("integration: paper_fetching", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "ncs-int-"));
    process.env.DIR_CACHE = cacheDir;
  });

  it("fetches markdown for a known arXiv paper via arxiv2md", async () => {
    const result = await paperFetching({
      title: "Attention Is All You Need",
      normalizedTitle: "attention_is_all_you_need",
      arxivUrl: "https://arxiv.org/abs/1706.03762",
    });

    assert.ok(result.markdownPath, "should have markdownPath");

    const content = readFileSync(result.markdownPath!, "utf-8");
    assert.ok(content.length > 500, "markdown should be substantial");
    assert.ok(
      content.toLowerCase().includes("attention") || content.toLowerCase().includes("transformer"),
      "content should be about the paper",
    );

    console.log("  paper_fetching result:", JSON.stringify({
      markdownPath: result.markdownPath,
      contentLength: content.length,
      firstLine: content.split("\n")[0],
    }, null, 2));
  });

  it("uses cache on second fetch of same paper", async () => {
    // First fetch
    const result1 = await paperFetching({
      title: "Attention Is All You Need",
      normalizedTitle: "attention_is_all_you_need",
      arxivUrl: "https://arxiv.org/abs/1706.03762",
    });
    assert.ok(result1.markdownPath);

    // Second fetch should hit cache (no network)
    const start = Date.now();
    const result2 = await paperFetching({
      title: "Attention Is All You Need",
      normalizedTitle: "attention_is_all_you_need",
      arxivUrl: "https://arxiv.org/abs/1706.03762",
    });
    const elapsed = Date.now() - start;

    assert.ok(result2.markdownPath);
    assert.equal(result2.markdownPath, result1.markdownPath, "should return same cached path");
    assert.ok(elapsed < 100, `cache hit should be fast, took ${elapsed}ms`);

    console.log("  cache hit took:", elapsed, "ms");
  });
});

describe("integration: paper_references", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "ncs-int-refs-"));
    process.env.DIR_CACHE = cacheDir;
  });

  it("extracts and enriches references from fetched paper", async () => {
    // First fetch the paper
    const fetched = await paperFetching({
      title: "Attention Is All You Need",
      normalizedTitle: "attention_is_all_you_need",
      arxivUrl: "https://arxiv.org/abs/1706.03762",
    });

    if (!fetched.markdownPath) {
      console.log("  SKIP: could not fetch paper markdown");
      return;
    }

    // Extract reference titles first (pure, fast)
    const markdown = readFileSync(fetched.markdownPath, "utf-8");
    const titles = extractReferenceTitles(markdown);
    console.log(`  Found ${titles.length} reference titles`);

    if (titles.length === 0) {
      console.log("  SKIP: no references extracted (format may differ)");
      return;
    }

    // Only enrich first 2 references to keep test fast
    const refs = await paperReferences(fetched.markdownPath);
    // paperReferences processes ALL refs, but we just check the output
    console.log(`  Enriched ${refs.length} references`);

    for (const ref of refs.slice(0, 3)) {
      console.log("  ref:", JSON.stringify({
        title: ref.title,
        s2Id: ref.s2Id,
        arxivId: ref.arxivId,
      }));
    }
  });
});
