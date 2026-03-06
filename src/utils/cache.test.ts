import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveMarkdown, saveMeta, loadMeta, loadMarkdownPath } from "./cache.js";
import type { PaperMeta } from "../types.js";

describe("cache", () => {
  let dir: string;
  const originalCache = process.env.DIR_CACHE;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "papernexus-test-"));
    process.env.DIR_CACHE = dir;
  });

  afterEach(() => {
    process.env.DIR_CACHE = originalCache;
    rmSync(dir, { recursive: true, force: true });
  });

  // ── saveMarkdown ──────────────────────────────────────────────

  describe("saveMarkdown", () => {
    it("saves markdown and returns absolute path", () => {
      const path = saveMarkdown("Test Paper", "# Hello World");
      assert.ok(path.endsWith(".md"));
      assert.ok(existsSync(path));
      assert.equal(readFileSync(path, "utf-8"), "# Hello World");
    });

    it("normalizes title for filename", () => {
      const path = saveMarkdown("GPT-4: A Large Model", "content");
      assert.ok(path.includes("gpt_4_a_large_model.md"));
    });

    it("overwrites existing file with same title", () => {
      saveMarkdown("Same Title", "version 1");
      const path = saveMarkdown("Same Title", "version 2");
      assert.equal(readFileSync(path, "utf-8"), "version 2");
    });

    it("handles large markdown content", () => {
      const bigContent = "# Paper\n" + "Lorem ipsum. ".repeat(10000);
      const path = saveMarkdown("Big Paper", bigContent);
      assert.equal(readFileSync(path, "utf-8"), bigContent);
    });

    it("handles markdown with unicode content", () => {
      const content = "# 论文标题\n\nMathematical formulas: ∑∫∂";
      const path = saveMarkdown("Unicode Paper", content);
      assert.equal(readFileSync(path, "utf-8"), content);
    });
  });

  // ── saveMeta / loadMeta ───────────────────────────────────────

  describe("saveMeta + loadMeta", () => {
    const fullMeta: PaperMeta = {
      title: "Attention Is All You Need",
      normalizedTitle: "attention_is_all_you_need",
      arxivId: "1706.03762",
      doi: "10.48550/arXiv.1706.03762",
      s2Id: "abc123",
      abstract: "The dominant sequence transduction models...",
      arxivUrl: "https://arxiv.org/abs/1706.03762",
      oaPdfUrl: "https://arxiv.org/pdf/1706.03762",
      year: 2017,
      authors: "Vaswani, Shazeer, Parmar",
      citationCount: 95000,
      sourceUrl: "https://papers.nips.cc/paper/7181",
      markdownPath: "/some/path/to/paper.md",
    };

    it("round-trips full PaperMeta with all fields", () => {
      saveMeta(fullMeta);
      const loaded = loadMeta("attention_is_all_you_need");
      assert.deepEqual(loaded, fullMeta);
    });

    it("round-trips minimal PaperMeta", () => {
      const minimal: PaperMeta = {
        title: "Minimal",
        normalizedTitle: "minimal",
      };
      saveMeta(minimal);
      const loaded = loadMeta("minimal");
      assert.deepEqual(loaded, minimal);
    });

    it("returns null for nonexistent meta", () => {
      assert.equal(loadMeta("does_not_exist"), null);
    });

    it("overwrites existing meta", () => {
      const v1: PaperMeta = { title: "Paper", normalizedTitle: "paper", year: 2020 };
      const v2: PaperMeta = { title: "Paper", normalizedTitle: "paper", year: 2021 };
      saveMeta(v1);
      saveMeta(v2);
      const loaded = loadMeta("paper");
      assert.equal(loaded?.year, 2021);
    });

    it("preserves optional undefined fields as absent in JSON", () => {
      const meta: PaperMeta = { title: "Test", normalizedTitle: "test" };
      saveMeta(meta);
      const raw = readFileSync(
        join(dir, "paper", "test.json"),
        "utf-8",
      );
      const parsed = JSON.parse(raw);
      assert.ok(!("arxivId" in parsed));
      assert.ok(!("doi" in parsed));
    });
  });

  // ── loadMarkdownPath ──────────────────────────────────────────

  describe("loadMarkdownPath", () => {
    it("returns path when markdown exists", () => {
      const saved = saveMarkdown("Cached Paper", "# content");
      const found = loadMarkdownPath("cached_paper");
      assert.equal(found, saved);
    });

    it("returns null when markdown does not exist", () => {
      assert.equal(loadMarkdownPath("nonexistent"), null);
    });

    it("works after saving with different title casing", () => {
      saveMarkdown("My Paper Title", "# content");
      // normTitle("My Paper Title") === "my_paper_title"
      const found = loadMarkdownPath("my_paper_title");
      assert.ok(found !== null);
    });
  });

  // ── Simulation: realistic workflow ────────────────────────────

  describe("simulation: realistic search-then-cache workflow", () => {
    it("simulates caching 5 papers from a search batch", () => {
      const papers: PaperMeta[] = [
        {
          title: "Attention Is All You Need",
          normalizedTitle: "attention_is_all_you_need",
          arxivId: "1706.03762",
          abstract: "The dominant sequence transduction models...",
          arxivUrl: "https://arxiv.org/abs/1706.03762",
          year: 2017,
          authors: "Vaswani et al.",
          citationCount: 95000,
        },
        {
          title: "BERT: Pre-training of Deep Bidirectional Transformers",
          normalizedTitle: "bert_pre_training_of_deep_bidirectional_transformers",
          doi: "10.18653/v1/N19-1423",
          abstract: "We introduce a new language representation model...",
          year: 2019,
          authors: "Devlin et al.",
        },
        {
          title: "Language Models are Few-Shot Learners",
          normalizedTitle: "language_models_are_few_shot_learners",
          arxivId: "2005.14165",
          abstract: "We demonstrate that scaling up language models...",
          arxivUrl: "https://arxiv.org/abs/2005.14165",
          year: 2020,
        },
        {
          title: "Scaling Laws for Neural Language Models",
          normalizedTitle: "scaling_laws_for_neural_language_models",
          abstract: "We study empirical scaling laws...",
          year: 2020,
        },
        {
          title: "An Image is Worth 16x16 Words",
          normalizedTitle: "an_image_is_worth_16x16_words",
          arxivId: "2010.11929",
          abstract: "While the Transformer architecture has become...",
          arxivUrl: "https://arxiv.org/abs/2010.11929",
          oaPdfUrl: "https://arxiv.org/pdf/2010.11929",
          year: 2021,
        },
      ];

      // Save all meta
      for (const p of papers) {
        saveMeta(p);
      }

      // Save markdown for 3 of them (simulating successful fetch)
      saveMarkdown(papers[0].title, "# Attention Is All You Need\n\nContent...");
      saveMarkdown(papers[2].title, "# GPT-3 Paper\n\nContent...");
      saveMarkdown(papers[4].title, "# ViT Paper\n\nContent...");

      // Verify all meta is loadable
      for (const p of papers) {
        const loaded = loadMeta(p.normalizedTitle);
        assert.ok(loaded, `Meta for "${p.title}" should be loadable`);
        assert.equal(loaded.title, p.title);
      }

      // Verify only 3 have cached markdown
      assert.ok(loadMarkdownPath("attention_is_all_you_need"));
      assert.equal(loadMarkdownPath("bert_pre_training_of_deep_bidirectional_transformers"), null);
      assert.ok(loadMarkdownPath("language_models_are_few_shot_learners"));
      assert.equal(loadMarkdownPath("scaling_laws_for_neural_language_models"), null);
      assert.ok(loadMarkdownPath("an_image_is_worth_16x16_words"));
    });
  });
});
