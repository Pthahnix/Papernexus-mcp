import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapPaper } from "../../src/utils/ss.js";
import type { PaperMeta } from "../../src/types.js";

describe("ss (Semantic Scholar)", () => {
  // ── mapPaper ──────────────────────────────────────────────────

  describe("mapPaper", () => {
    it("maps a full Semantic Scholar API response", () => {
      const raw = {
        paperId: "204e3073870fae3d05bcbc2f6a8e263d9b72e776",
        title: "Attention Is All You Need",
        year: 2017,
        authors: [
          { name: "Ashish Vaswani" },
          { name: "Noam Shazeer" },
          { name: "Niki Parmar" },
        ],
        abstract: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
        citationCount: 95000,
        externalIds: {
          ArXiv: "1706.03762",
          DOI: "10.48550/arXiv.1706.03762",
          DBLP: "journals/corr/VaswaniSPUJGKP17",
        },
        openAccessPdf: {
          url: "https://arxiv.org/pdf/1706.03762",
          status: "GREEN",
        },
        url: "https://www.semanticscholar.org/paper/204e3073870fae3d05bcbc2f6a8e263d9b72e776",
      };

      const result = mapPaper(raw);
      assert.ok(result);
      assert.equal(result.title, "Attention Is All You Need");
      assert.equal(result.normalizedTitle, "attention_is_all_you_need");
      assert.equal(result.s2Id, "204e3073870fae3d05bcbc2f6a8e263d9b72e776");
      assert.equal(result.arxivId, "1706.03762");
      assert.equal(result.doi, "10.48550/arXiv.1706.03762");
      assert.equal(result.arxivUrl, "https://arxiv.org/abs/1706.03762");
      assert.equal(result.oaPdfUrl, "https://arxiv.org/pdf/1706.03762");
      assert.equal(result.year, 2017);
      assert.equal(result.citationCount, 95000);
      assert.equal(result.authors, "Ashish Vaswani, Noam Shazeer, Niki Parmar");
      assert.ok(result.abstract?.startsWith("The dominant"));
      assert.ok(result.sourceUrl?.includes("semanticscholar.org"));
    });

    it("maps paper without arXiv ID", () => {
      const raw = {
        paperId: "abc123",
        title: "A Non-arXiv Paper",
        year: 2020,
        authors: [{ name: "Author One" }],
        abstract: "Some abstract.",
        citationCount: 50,
        externalIds: { DOI: "10.1234/test" },
        url: "https://www.semanticscholar.org/paper/abc123",
      };

      const result = mapPaper(raw);
      assert.ok(result);
      assert.equal(result.arxivId, undefined);
      assert.equal(result.arxivUrl, undefined);
      assert.equal(result.doi, "10.1234/test");
      assert.equal(result.oaPdfUrl, undefined);
    });

    it("maps paper without openAccessPdf", () => {
      const raw = {
        paperId: "def456",
        title: "Closed Access Paper",
        year: 2019,
        authors: [{ name: "Author" }],
        externalIds: {},
      };

      const result = mapPaper(raw);
      assert.ok(result);
      assert.equal(result.oaPdfUrl, undefined);
    });

    it("maps paper with empty externalIds", () => {
      const raw = {
        paperId: "ghi789",
        title: "Minimal Paper",
        externalIds: {},
      };

      const result = mapPaper(raw);
      assert.ok(result);
      assert.equal(result.arxivId, undefined);
      assert.equal(result.doi, undefined);
    });

    it("maps paper without externalIds field at all", () => {
      const raw = {
        paperId: "jkl012",
        title: "No External IDs",
      };

      const result = mapPaper(raw);
      assert.ok(result);
      assert.equal(result.arxivId, undefined);
      assert.equal(result.doi, undefined);
    });

    it("maps paper without authors", () => {
      const raw = {
        paperId: "mno345",
        title: "Authorless Paper",
      };

      const result = mapPaper(raw);
      assert.ok(result);
      assert.equal(result.authors, undefined);
    });

    it("returns null for null input", () => {
      assert.equal(mapPaper(null), null);
    });

    it("returns null for undefined input", () => {
      assert.equal(mapPaper(undefined), null);
    });

    it("returns null for object without title", () => {
      assert.equal(mapPaper({ paperId: "abc", year: 2020 }), null);
    });

    it("returns null for empty object", () => {
      assert.equal(mapPaper({}), null);
    });
  });

  // ── Simulation: batch reference parsing ───────────────────

  describe("simulation: parsing a references API response", () => {
    it("parses a realistic references response with mixed quality", () => {
      // Simulates what Semantic Scholar /references endpoint returns
      const apiResponse = {
        data: [
          {
            citedPaper: {
              paperId: "ref1",
              title: "Neural Machine Translation by Jointly Learning to Align and Translate",
              year: 2015,
              authors: [{ name: "Bahdanau" }, { name: "Cho" }, { name: "Bengio" }],
              abstract: "Neural machine translation is a recently proposed approach...",
              citationCount: 22000,
              externalIds: { ArXiv: "1409.0473", DOI: "10.48550/arXiv.1409.0473" },
              openAccessPdf: { url: "https://arxiv.org/pdf/1409.0473" },
              url: "https://www.semanticscholar.org/paper/ref1",
            },
          },
          {
            citedPaper: {
              paperId: "ref2",
              title: "Sequence to Sequence Learning with Neural Networks",
              year: 2014,
              authors: [{ name: "Sutskever" }, { name: "Vinyals" }, { name: "Le" }],
              abstract: "Deep Neural Networks (DNNs) are powerful models...",
              citationCount: 18000,
              externalIds: { ArXiv: "1409.3215" },
              url: "https://www.semanticscholar.org/paper/ref2",
            },
          },
          // Malformed reference — no citedPaper title
          {
            citedPaper: {
              paperId: "ref3",
            },
          },
          // Null reference
          {
            citedPaper: null,
          },
          {
            citedPaper: {
              paperId: "ref4",
              title: "Adam: A Method for Stochastic Optimization",
              year: 2015,
              authors: [{ name: "Kingma" }, { name: "Ba" }],
              abstract: "We introduce Adam, an algorithm for first-order gradient-based optimization...",
              citationCount: 130000,
              externalIds: { ArXiv: "1412.6980", DOI: "10.48550/arXiv.1412.6980" },
              openAccessPdf: { url: "https://arxiv.org/pdf/1412.6980" },
              url: "https://www.semanticscholar.org/paper/ref4",
            },
          },
        ],
      };

      const results = apiResponse.data
        .map((r: any) => mapPaper(r.citedPaper))
        .filter((p: PaperMeta | null): p is PaperMeta => p !== null);

      // Should get 3 valid results, filtering out the malformed ones
      assert.equal(results.length, 3);

      // Verify first reference
      assert.equal(results[0].arxivId, "1409.0473");
      assert.equal(results[0].year, 2015);
      assert.ok(results[0].oaPdfUrl?.includes("1409.0473"));

      // Verify second — no openAccessPdf
      assert.equal(results[1].arxivId, "1409.3215");
      assert.equal(results[1].oaPdfUrl, undefined);

      // Verify third — Adam optimizer, high citations
      assert.equal(results[2].citationCount, 130000);
      assert.equal(results[2].arxivId, "1412.6980");

      // All should have unique normalizedTitles
      const titles = new Set(results.map((r) => r.normalizedTitle));
      assert.equal(titles.size, 3);
    });
  });

  // ── Simulation: edge case responses ──────────────────────

  describe("simulation: edge case API responses", () => {
    it("handles paper with very long author list", () => {
      const raw = {
        paperId: "long_authors",
        title: "Large Collaboration Paper",
        authors: Array.from({ length: 50 }, (_, i) => ({ name: `Author ${i + 1}` })),
      };

      const result = mapPaper(raw);
      assert.ok(result);
      assert.ok(result.authors?.includes("Author 1"));
      assert.ok(result.authors?.includes("Author 50"));
      // 50 authors joined by ", "
      assert.equal(result.authors?.split(", ").length, 50);
    });

    it("handles paper with null fields in externalIds", () => {
      const raw = {
        paperId: "null_fields",
        title: "Null External IDs",
        externalIds: { ArXiv: null, DOI: null },
      };

      const result = mapPaper(raw);
      assert.ok(result);
      // null should become undefined via ?? operator
      assert.equal(result.arxivId, undefined);
      assert.equal(result.doi, undefined);
    });

    it("handles paper with empty string title (still valid)", () => {
      // Empty string is falsy, mapPaper checks !p.title
      const raw = { paperId: "empty", title: "" };
      const result = mapPaper(raw);
      // Empty string is falsy → returns null
      assert.equal(result, null);
    });
  });
});
