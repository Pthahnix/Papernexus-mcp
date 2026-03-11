import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { extractReferenceTitles, paperReferences } from "../../src/tools/paper_references.js";

const originalFetch = global.fetch;

describe("paper_references", () => {
  // ── extractReferenceTitles (pure function) ──────────────

  describe("extractReferenceTitles", () => {
    it("extracts numbered references with quoted titles", () => {
      const md = `# Introduction
Some text.

## References

[1] Smith, J. "Attention Is All You Need." NeurIPS 2017.
[2] Brown, T. "Language Models are Few-Shot Learners." NeurIPS 2020.
`;
      const titles = extractReferenceTitles(md);
      assert.equal(titles.length, 2);
      assert.equal(titles[0], "Attention Is All You Need");
      assert.equal(titles[1], "Language Models are Few-Shot Learners");
    });

    it("extracts numbered references with unquoted titles", () => {
      const md = `## References

[1] Vaswani, A. Attention Is All You Need. NeurIPS 2017.
`;
      const titles = extractReferenceTitles(md);
      assert.equal(titles.length, 1);
      assert.equal(titles[0], "Attention Is All You Need");
    });

    it("returns empty array when no references section", () => {
      const md = `# Introduction\nSome text.\n## Conclusion\nDone.`;
      assert.deepEqual(extractReferenceTitles(md), []);
    });

    it("stops at next heading after references", () => {
      const md = `## References

[1] Smith. "Paper Title One Is Here." 2020.

## Appendix

[2] Jones. "Should Not Match." 2021.
`;
      const titles = extractReferenceTitles(md);
      assert.equal(titles.length, 1);
      assert.equal(titles[0], "Paper Title One Is Here");
    });

    it("handles case-insensitive section headings", () => {
      const md = `### REFERENCES

[1] Author. "Deep Learning for Natural Language Processing." 2019.
`;
      const titles = extractReferenceTitles(md);
      assert.equal(titles.length, 1);
    });

    it("handles bibliography as section name", () => {
      const md = `## Bibliography

[1] Author. "A Very Important Paper About Things." 2020.
`;
      const titles = extractReferenceTitles(md);
      assert.equal(titles.length, 1);
    });

    it("handles works cited as section name", () => {
      const md = `## Works Cited

[1] Author. "Neural Machine Translation by Jointly Learning." 2014.
`;
      const titles = extractReferenceTitles(md);
      assert.equal(titles.length, 1);
    });

    it("extracts bulleted references when no numbered ones found", () => {
      const md = `## References

- Smith, J. "Attention Is All You Need." NeurIPS 2017.
- Brown, T. "Language Models are Few-Shot Learners." NeurIPS 2020.
`;
      const titles = extractReferenceTitles(md);
      assert.equal(titles.length, 2);
    });

    it("filters out short titles (< 10 chars)", () => {
      const md = `## References

[1] Author. "Short." 2020.
[2] Author. "This Is A Long Enough Title." 2020.
`;
      const titles = extractReferenceTitles(md);
      assert.equal(titles.length, 1);
      assert.equal(titles[0], "This Is A Long Enough Title");
    });

    it("handles empty references section", () => {
      const md = `## References

## Appendix
Some content.
`;
      const titles = extractReferenceTitles(md);
      assert.equal(titles.length, 0);
    });

    it("handles references at end of document (no next heading)", () => {
      const md = `# Paper

## References

[1] Author. "A Complete Paper Title That Is Long Enough." 2021.
[2] Author. "Another Complete Paper Title Here Too." 2022.
`;
      const titles = extractReferenceTitles(md);
      assert.equal(titles.length, 2);
    });

    it("handles many references", () => {
      let refs = "## References\n\n";
      for (let i = 1; i <= 20; i++) {
        refs += `[${i}] Author${i}. "Paper Number ${i} With Sufficient Length." ${2000 + i}.\n`;
      }
      const titles = extractReferenceTitles(refs);
      assert.equal(titles.length, 20);
    });
  });

  // ── paperReferences (integration with enrichMeta) ───────

  describe("paperReferences with mocked APIs", () => {
    let tmpDir: string;
    const originalCache = process.env.DIR_CACHE;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "ncs-refs-"));
      process.env.DIR_CACHE = tmpDir;
    });

    afterEach(() => {
      process.env.DIR_CACHE = originalCache;
      global.fetch = originalFetch;
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("extracts and enriches references from a markdown file", async () => {
      const mdPath = resolve(tmpDir, "test_paper.md");
      writeFileSync(
        mdPath,
        `# Test Paper

## Introduction
This is a test paper.

## References

[1] Vaswani, A. "Attention Is All You Need." NeurIPS 2017.
[2] Devlin, J. "BERT Pre-training of Deep Bidirectional Transformers." NAACL 2019.
`,
      );

      // Mock all APIs to return minimal data
      global.fetch = async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });

      const results = await paperReferences(mdPath);
      assert.equal(results.length, 2);
      assert.equal(results[0].title, "Attention Is All You Need");
      assert.equal(results[1].title, "BERT Pre-training of Deep Bidirectional Transformers");
    });

    it("returns empty array for paper with no references", async () => {
      const mdPath = resolve(tmpDir, "no_refs.md");
      writeFileSync(mdPath, "# Paper\n\n## Introduction\n\nNo references here.");

      const results = await paperReferences(mdPath);
      assert.deepEqual(results, []);
    });

    it("enriches references with Semantic Scholar data", async () => {
      const mdPath = resolve(tmpDir, "enriched_refs.md");
      writeFileSync(
        mdPath,
        `## References

[1] Author. "Attention Is All You Need." 2017.
`,
      );

      process.env.EMAIL_UNPAYWALL = "test@example.com";

      global.fetch = async (url: any) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("semanticscholar.org")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  paperId: "ss_attention",
                  title: "Attention Is All You Need",
                  year: 2017,
                  authors: [{ name: "Vaswani" }],
                  abstract: "The dominant sequence...",
                  citationCount: 95000,
                  externalIds: { ArXiv: "1706.03762" },
                  openAccessPdf: { url: "https://arxiv.org/pdf/1706.03762" },
                  url: "https://semanticscholar.org/paper/ss_attention",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(null, { status: 404 });
      };

      const results = await paperReferences(mdPath);
      assert.equal(results.length, 1);
      assert.equal(results[0].s2Id, "ss_attention");
      assert.equal(results[0].arxivId, "1706.03762");
      assert.equal(results[0].citationCount, 95000);
    });

    it("handles enrichment failures gracefully (allSettled)", async () => {
      const mdPath = resolve(tmpDir, "failing_refs.md");
      writeFileSync(
        mdPath,
        `## References

[1] Author. "First Paper With Enough Title Length." 2020.
[2] Author. "Second Paper With Enough Title Too." 2021.
`,
      );

      // All APIs fail
      global.fetch = async () => {
        throw new Error("Network error");
      };

      // Should not throw — allSettled catches failures
      const results = await paperReferences(mdPath);
      // With allSettled, failed promises are simply skipped
      assert.ok(Array.isArray(results));
    });

    it("processes references in batches of 3", async () => {
      // Create a paper with 5 references
      let refsSection = "## References\n\n";
      for (let i = 1; i <= 5; i++) {
        refsSection += `[${i}] Author. "Paper Reference Number ${i} Long Enough." ${2020 + i}.\n`;
      }
      const mdPath = resolve(tmpDir, "batch_refs.md");
      writeFileSync(mdPath, refsSection);

      let fetchCallCount = 0;
      global.fetch = async () => {
        fetchCallCount++;
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const results = await paperReferences(mdPath);
      assert.equal(results.length, 5);
      // Should have made multiple fetch calls (SS for each reference)
      assert.ok(fetchCallCount > 0, "should have made fetch calls for enrichment");
    });
  });

  // ── Simulation: realistic paper references ──────────────

  describe("simulation: realistic paper with references", () => {
    let tmpDir: string;
    const originalCache = process.env.DIR_CACHE;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "ncs-refsim-"));
      process.env.DIR_CACHE = tmpDir;
    });

    afterEach(() => {
      process.env.DIR_CACHE = originalCache;
      global.fetch = originalFetch;
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("processes a realistic paper markdown with mixed reference formats", async () => {
      const paperMd = `# Attention Is All You Need

## Abstract

The dominant sequence transduction models are based on complex recurrent
or convolutional neural networks...

## 1 Introduction

Recurrent neural networks, long short-term memory and gated recurrent
neural networks in particular, have been firmly established as state of
the art approaches in sequence modeling and transduction problems...

## References

[1] Bahdanau, D. "Neural Machine Translation by Jointly Learning to Align and Translate." ICLR 2015.
[2] Sutskever, I. "Sequence to Sequence Learning with Neural Networks." NeurIPS 2014.
[3] Gehring, J. "Convolutional Sequence to Sequence Learning." ICML 2017.
[4] Wu, Y. "Google's Neural Machine Translation System." arXiv 2016.
`;

      const mdPath = resolve(tmpDir, "attention_paper.md");
      writeFileSync(mdPath, paperMd);

      // Mock SS to return basic data
      global.fetch = async (url: any) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("semanticscholar.org")) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        // arXiv search returns nothing
        if (urlStr.includes("export.arxiv.org")) {
          return new Response(
            '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>',
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      };

      const refs = await paperReferences(mdPath);

      assert.equal(refs.length, 4);

      // Verify all have titles and normalizedTitles
      for (const ref of refs) {
        assert.ok(ref.title.length > 10, `title should be long: ${ref.title}`);
        assert.ok(ref.normalizedTitle.length > 0);
      }

      // Verify specific titles extracted correctly
      const titles = refs.map((r) => r.title);
      assert.ok(titles.includes("Neural Machine Translation by Jointly Learning to Align and Translate"));
      assert.ok(titles.includes("Sequence to Sequence Learning with Neural Networks"));

      // All normalizedTitles should be unique
      const uniqueNorm = new Set(refs.map((r) => r.normalizedTitle));
      assert.equal(uniqueNorm.size, 4);
    });
  });
});
