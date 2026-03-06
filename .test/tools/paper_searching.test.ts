import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseApifyItem } from "../../src/tools/paper_searching.js";
import type { ApifyScholarItem } from "../../src/tools/paper_searching.js";

// Save and restore fetch for mocked enrichMeta tests
const originalFetch = global.fetch;

describe("paper_searching", () => {
  // ── parseApifyItem (pure function) ────────────────────────

  describe("parseApifyItem", () => {
    it("parses a realistic Google Scholar item with arXiv link", () => {
      const item: ApifyScholarItem = {
        title: "Attention Is All You Need",
        link: "https://arxiv.org/abs/1706.03762",
        authors: "A Vaswani, N Shazeer, N Parmar",
        year: "2017",
        citations: "95000",
        searchMatch: "The dominant sequence transduction models are based on complex recurrent...",
        documentLink: "https://arxiv.org/pdf/1706.03762",
      };

      const meta = parseApifyItem(item);
      assert.equal(meta.title, "Attention Is All You Need");
      assert.equal(meta.normalizedTitle, "attention_is_all_you_need");
      assert.equal(meta.arxivId, "1706.03762");
      assert.equal(meta.arxivUrl, "https://arxiv.org/abs/1706.03762");
      assert.equal(meta.year, 2017);
      assert.equal(meta.authors, "A Vaswani, N Shazeer, N Parmar");
      assert.equal(meta.citationCount, 95000);
      assert.equal(meta.abstract, "The dominant sequence transduction models are based on complex recurrent...");
      assert.equal(meta.oaPdfUrl, undefined); // documentLink is NOT used as oaPdfUrl
      assert.equal(meta.sourceUrl, "https://arxiv.org/abs/1706.03762");
    });

    it("parses item without arXiv link", () => {
      const item: ApifyScholarItem = {
        title: "Some Conference Paper",
        link: "https://dl.acm.org/doi/10.1145/12345",
        authors: "J Smith, K Jones",
        year: "2022",
        citations: "50",
        searchMatch: "We present a novel approach...",
      };

      const meta = parseApifyItem(item);
      assert.equal(meta.title, "Some Conference Paper");
      assert.equal(meta.arxivId, undefined);
      assert.equal(meta.arxivUrl, undefined);
      assert.equal(meta.year, 2022);
      assert.equal(meta.citationCount, 50);
      assert.equal(meta.sourceUrl, "https://dl.acm.org/doi/10.1145/12345");
    });

    it("handles year as number", () => {
      const item: ApifyScholarItem = { title: "Paper", year: 2023 };
      const meta = parseApifyItem(item);
      assert.equal(meta.year, 2023);
    });

    it("handles year with extra text like '… - 2024 - Springer'", () => {
      const item: ApifyScholarItem = { title: "Paper", year: "… - 2024 - Springer" };
      const meta = parseApifyItem(item);
      assert.equal(meta.year, 2024);
    });

    it("handles citations as number", () => {
      const item: ApifyScholarItem = { title: "Paper", citations: 42 };
      const meta = parseApifyItem(item);
      assert.equal(meta.citationCount, 42);
    });

    it("handles citations as string '0'", () => {
      const item: ApifyScholarItem = { title: "Paper", citations: "0" };
      const meta = parseApifyItem(item);
      assert.equal(meta.citationCount, 0);
    });

    it("handles completely empty item", () => {
      const item: ApifyScholarItem = {};
      const meta = parseApifyItem(item);
      assert.equal(meta.title, "");
      assert.equal(meta.normalizedTitle, "");
      assert.equal(meta.arxivId, undefined);
      assert.equal(meta.year, undefined);
      assert.equal(meta.authors, undefined);
      assert.equal(meta.citationCount, undefined);
    });

    it("handles item with only title", () => {
      const item: ApifyScholarItem = { title: "Minimal Paper" };
      const meta = parseApifyItem(item);
      assert.equal(meta.title, "Minimal Paper");
      assert.equal(meta.normalizedTitle, "minimal_paper");
    });

    it("extracts arXiv ID from pdf URL in link", () => {
      const item: ApifyScholarItem = {
        title: "Paper",
        link: "https://arxiv.org/pdf/2301.12345v2",
      };
      const meta = parseApifyItem(item);
      assert.equal(meta.arxivId, "2301.12345");
      assert.equal(meta.arxivUrl, "https://arxiv.org/abs/2301.12345");
    });
  });

  // ── enrichMeta (mocked fetch) ────────────────────────────

  describe("enrichMeta with mocked APIs", () => {
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("enriches metadata from Semantic Scholar", async () => {
      // Mock SS API response
      const ssResponse = {
        data: [{
          paperId: "ss_id_123",
          title: "Test Paper",
          year: 2021,
          authors: [{ name: "Alice" }, { name: "Bob" }],
          abstract: "This is a great paper about testing.",
          citationCount: 100,
          externalIds: { ArXiv: "2101.00001", DOI: "10.1234/test" },
          openAccessPdf: { url: "https://arxiv.org/pdf/2101.00001" },
          url: "https://semanticscholar.org/paper/ss_id_123",
        }],
      };

      global.fetch = async (url: any) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("semanticscholar.org")) {
          return new Response(JSON.stringify(ssResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(null, { status: 404 });
      };

      const { enrichMeta } = await import("../../src/tools/paper_searching.js");
      const meta = await enrichMeta({
        title: "Test Paper",
        normalizedTitle: "test_paper",
      });

      assert.equal(meta.s2Id, "ss_id_123");
      assert.equal(meta.abstract, "This is a great paper about testing.");
      assert.equal(meta.arxivId, "2101.00001");
      assert.equal(meta.doi, "10.1234/test");
      assert.equal(meta.oaPdfUrl, "https://arxiv.org/pdf/2101.00001");
      assert.equal(meta.citationCount, 100);
    });

    it("does not overwrite existing fields with SS data", async () => {
      const ssResponse = {
        data: [{
          paperId: "ss_id_456",
          title: "Test Paper",
          year: 2020,
          authors: [{ name: "SS Author" }],
          abstract: "SS abstract",
          externalIds: { ArXiv: "2001.00001" },
        }],
      };

      global.fetch = async (url: any) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("semanticscholar.org")) {
          return new Response(JSON.stringify(ssResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(null, { status: 404 });
      };

      const { enrichMeta } = await import("../../src/tools/paper_searching.js");
      const meta = await enrichMeta({
        title: "Test Paper",
        normalizedTitle: "test_paper",
        year: 2021,          // existing, should NOT be overwritten
        authors: "Original", // existing, should NOT be overwritten
        abstract: "Original abstract",
      });

      assert.equal(meta.year, 2021);           // kept original
      assert.equal(meta.authors, "Original");   // kept original
      assert.equal(meta.abstract, "Original abstract"); // kept original
      assert.equal(meta.s2Id, "ss_id_456");     // new from SS
    });

    it("falls back to arXiv when SS has no arxivUrl", async () => {
      process.env.EMAIL_UNPAYWALL = "test@example.com";

      // SS returns no arXiv info
      const ssResponse = {
        data: [{
          paperId: "ss_no_arxiv",
          title: "Non-arXiv Paper",
          abstract: "Some abstract",
          externalIds: { DOI: "10.1234/noarxiv" },
        }],
      };

      // arXiv returns a match
      const arxivXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://arxiv.org/abs/2301.99999v1</id>
    <title>Non-arXiv Paper</title>
    <summary>arXiv abstract for this paper.</summary>
    <author><name>arXiv Author</name></author>
    <published>2023-01-15</published>
  </entry>
</feed>`;

      global.fetch = async (url: any) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("semanticscholar.org")) {
          return new Response(JSON.stringify(ssResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("export.arxiv.org")) {
          return new Response(arxivXml, {
            status: 200,
            headers: { "Content-Type": "application/xml" },
          });
        }
        // Unpaywall should NOT be called because we now have arxivUrl
        return new Response(null, { status: 404 });
      };

      const { enrichMeta } = await import("../../src/tools/paper_searching.js");
      const meta = await enrichMeta({
        title: "Non-arXiv Paper",
        normalizedTitle: "non_arxiv_paper",
      });

      assert.equal(meta.arxivId, "2301.99999");
      assert.equal(meta.arxivUrl, "https://arxiv.org/abs/2301.99999");
    });

    it("falls back to Unpaywall when has DOI but no oaPdfUrl", async () => {
      // SS returns DOI but no open access PDF
      const ssResponse = {
        data: [{
          paperId: "ss_closed",
          title: "Closed Paper",
          abstract: "Abstract",
          externalIds: { DOI: "10.1234/closed" },
        }],
      };

      // arXiv returns nothing
      const emptyArxiv = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
</feed>`;

      // Unpaywall returns OA PDF
      const unpaywallResponse = {
        title: "Closed Paper",
        year: 2022,
        doi_url: "https://doi.org/10.1234/closed",
        best_oa_location: {
          url_for_pdf: "https://repository.example.com/paper.pdf",
        },
        z_authors: [{ given: "Test", family: "Author" }],
      };

      process.env.EMAIL_UNPAYWALL = "test@example.com";

      global.fetch = async (url: any) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("semanticscholar.org")) {
          return new Response(JSON.stringify(ssResponse), { status: 200 });
        }
        if (urlStr.includes("export.arxiv.org")) {
          return new Response(emptyArxiv, { status: 200 });
        }
        if (urlStr.includes("unpaywall.org")) {
          return new Response(JSON.stringify(unpaywallResponse), { status: 200 });
        }
        return new Response(null, { status: 404 });
      };

      const { enrichMeta } = await import("../../src/tools/paper_searching.js");
      const meta = await enrichMeta({
        title: "Closed Paper",
        normalizedTitle: "closed_paper",
      });

      assert.equal(meta.doi, "10.1234/closed");
      assert.equal(meta.oaPdfUrl, "https://repository.example.com/paper.pdf");
    });

    it("handles all APIs returning nothing gracefully", async () => {
      global.fetch = async () => new Response(null, { status: 404 });

      const { enrichMeta } = await import("../../src/tools/paper_searching.js");
      const meta = await enrichMeta({
        title: "Unknown Paper",
        normalizedTitle: "unknown_paper",
      });

      // Should return original meta unchanged (no crash)
      assert.equal(meta.title, "Unknown Paper");
      assert.equal(meta.s2Id, undefined);
      assert.equal(meta.arxivUrl, undefined);
      assert.equal(meta.oaPdfUrl, undefined);
    });
  });

  // ── Simulation: batch of apify results ────────────────────

  describe("simulation: parsing a batch of Google Scholar results", () => {
    it("parses 5 realistic Google Scholar items", () => {
      const items: ApifyScholarItem[] = [
        {
          title: "Attention Is All You Need",
          link: "https://arxiv.org/abs/1706.03762",
          authors: "A Vaswani, N Shazeer, N Parmar, J Uszkoreit, L Jones, AN Gomez",
          year: "2017",
          citations: "95000",
          searchMatch: "The dominant sequence transduction models...",
          documentLink: "https://arxiv.org/pdf/1706.03762",
        },
        {
          title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
          link: "https://arxiv.org/abs/1810.04805",
          authors: "J Devlin, MW Chang, K Lee, K Toutanova",
          year: "2018",
          citations: "65000",
          searchMatch: "We introduce a new language representation model...",
        },
        {
          title: "A Survey on Deep Learning",
          link: "https://www.sciencedirect.com/science/article/pii/S0893608014002135",
          authors: "Y LeCun, Y Bengio, G Hinton",
          year: "2015",
          citations: "45000",
          searchMatch: "Deep learning allows computational models...",
          documentLink: "https://www.cs.toronto.edu/~hinton/absps/NatureDeepReview.pdf",
        },
        {
          title: "ImageNet Classification with Deep Convolutional Neural Networks",
          link: "https://papers.nips.cc/paper/4824",
          authors: "A Krizhevsky, I Sutskever, GE Hinton",
          year: "2012",
          citations: "110000",
        },
        {
          // Minimal item from a bad scrape
          title: "Some Obscure Paper",
        },
      ];

      const results = items.map(parseApifyItem);
      assert.equal(results.length, 5);

      // First two have arXiv IDs
      assert.equal(results[0].arxivId, "1706.03762");
      assert.equal(results[1].arxivId, "1810.04805");

      // Third has no arXiv and documentLink is not used as oaPdfUrl
      assert.equal(results[2].arxivId, undefined);
      assert.equal(results[2].oaPdfUrl, undefined);

      // Fourth has no PDF
      assert.equal(results[3].oaPdfUrl, undefined);
      assert.equal(results[3].citationCount, 110000);

      // Fifth is minimal
      assert.equal(results[4].title, "Some Obscure Paper");
      assert.equal(results[4].year, undefined);
      assert.equal(results[4].authors, undefined);

      // All should have normalizedTitles
      for (const r of results) {
        assert.ok(typeof r.normalizedTitle === "string");
      }

      // All titles should be unique after normalization
      const uniqueTitles = new Set(results.map((r) => r.normalizedTitle));
      assert.equal(uniqueTitles.size, 5);
    });
  });
});
