import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { normTitle } from "../../src/utils/misc.js";
import { saveMarkdown, saveMeta, loadMeta, loadMarkdownPath } from "../../src/utils/cache.js";
import { urlToId, idToUrl, parseEntry } from "../../src/utils/arxiv.js";
import { mapPaper } from "../../src/utils/ss.js";
import type { PaperMeta } from "../../src/types.js";

/**
 * Feature test: all utils working together.
 * Simulates a realistic pipeline: parse API data → normalize → cache.
 */
describe("feature: utils integration", () => {
  let cacheDir: string;
  const originalCache = process.env.DIR_CACHE;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "ncs-feature-"));
    process.env.DIR_CACHE = cacheDir;
  });

  afterEach(() => {
    process.env.DIR_CACHE = originalCache;
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("arXiv parse → normalize → cache roundtrip", () => {
    // 1. Parse an arXiv API entry
    const entry = {
      id: "https://arxiv.org/abs/1706.03762v7",
      title: "Attention Is All You Need",
      summary: "The dominant sequence transduction models...",
      author: [{ name: "Vaswani" }, { name: "Shazeer" }],
      published: "2017-06-12T17:57:34Z",
    };
    const meta = parseEntry(entry);
    assert.ok(meta);

    // 2. Verify normTitle consistency
    assert.equal(meta.normalizedTitle, normTitle(meta.title));

    // 3. Cache the metadata
    saveMeta(meta);
    const loaded = loadMeta(meta.normalizedTitle);
    assert.deepEqual(loaded, meta);

    // 4. Simulate fetching markdown and caching it
    const fakeMarkdown = "# Attention Is All You Need\n\n## Abstract\n\nContent...";
    const mdPath = saveMarkdown(meta.title, fakeMarkdown);

    // 5. Verify cache lookup works
    const cachedPath = loadMarkdownPath(meta.normalizedTitle);
    assert.equal(cachedPath, mdPath);
  });

  it("Semantic Scholar parse → normalize → cache roundtrip", () => {
    // 1. Parse a Semantic Scholar API response
    const raw = {
      paperId: "204e3073",
      title: "BERT: Pre-training of Deep Bidirectional Transformers",
      year: 2019,
      authors: [{ name: "Devlin" }, { name: "Chang" }],
      abstract: "We introduce a new language representation model...",
      citationCount: 65000,
      externalIds: { ArXiv: "1810.04805", DOI: "10.18653/v1/N19-1423" },
      openAccessPdf: { url: "https://arxiv.org/pdf/1810.04805" },
      url: "https://www.semanticscholar.org/paper/204e3073",
    };
    const meta = mapPaper(raw);
    assert.ok(meta);

    // 2. Verify cross-util consistency
    assert.equal(meta.normalizedTitle, normTitle(meta.title));
    assert.equal(meta.arxivUrl, idToUrl(meta.arxivId!));
    assert.equal(urlToId(meta.arxivUrl!), meta.arxivId);

    // 3. Cache and verify
    saveMeta(meta);
    const loaded = loadMeta(meta.normalizedTitle);
    assert.ok(loaded);
    assert.equal(loaded.s2Id, "204e3073");
    assert.equal(loaded.doi, "10.18653/v1/N19-1423");
    assert.equal(loaded.oaPdfUrl, "https://arxiv.org/pdf/1810.04805");
  });

  it("simulates a full search batch: parse → deduplicate → cache", () => {
    // Simulate: arXiv and SS return overlapping results for same paper
    const arxivEntry = {
      id: "https://arxiv.org/abs/2005.14165v4",
      title: "Language Models are Few-Shot Learners",
      summary: "Recent work has demonstrated substantial gains...",
      author: [{ name: "Brown" }],
      published: "2020-05-28",
    };

    const ssRaw = {
      paperId: "gpt3_id",
      title: "Language Models are Few-Shot Learners",
      year: 2020,
      authors: [{ name: "Tom Brown" }, { name: "Benjamin Mann" }],
      abstract: "Recent work has demonstrated substantial gains on many NLP benchmarks...",
      citationCount: 25000,
      externalIds: { ArXiv: "2005.14165" },
      openAccessPdf: { url: "https://arxiv.org/pdf/2005.14165" },
      url: "https://semanticscholar.org/paper/gpt3_id",
    };

    const fromArxiv = parseEntry(arxivEntry)!;
    const fromSS = mapPaper(ssRaw)!;

    // Both should produce the same normalizedTitle
    assert.equal(fromArxiv.normalizedTitle, fromSS.normalizedTitle);

    // SS has richer data, so use it as primary and merge
    const merged: PaperMeta = { ...fromArxiv, ...fromSS };
    assert.equal(merged.s2Id, "gpt3_id");
    assert.equal(merged.arxivId, "2005.14165");
    assert.equal(merged.citationCount, 25000);
    assert.ok(merged.oaPdfUrl);

    // Cache the merged result
    saveMeta(merged);
    saveMarkdown(merged.title, "# GPT-3 Paper\n\nContent...");

    // Verify both cache paths work
    const loadedMeta = loadMeta(merged.normalizedTitle);
    assert.ok(loadedMeta);
    assert.equal(loadedMeta.s2Id, "gpt3_id");

    const mdPath = loadMarkdownPath(merged.normalizedTitle);
    assert.ok(mdPath);
  });

  it("verifies dedup across title variants", () => {
    // These should all normalize to the same key
    const variants = [
      "Attention Is All You Need",
      "attention is all you need",
      "  Attention  Is  All  You  Need  ",
      "ATTENTION IS ALL YOU NEED",
    ];

    const normalized = variants.map(normTitle);
    const unique = new Set(normalized);
    assert.equal(unique.size, 1);

    // Save with first variant, load with any
    const meta: PaperMeta = {
      title: variants[0],
      normalizedTitle: normalized[0],
      abstract: "Test abstract",
    };
    saveMeta(meta);

    for (const n of normalized) {
      const loaded = loadMeta(n);
      assert.ok(loaded, `Should load with normalizedTitle: ${n}`);
      assert.equal(loaded.title, variants[0]);
    }
  });
});
