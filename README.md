# Neocortica-Scholar

A component of [Neocortica](https://github.com/Pthahnix/Neocortica) — an MCP server for academic paper searching, fetching, reading, and reference exploration.

## Tools

| Tool | Description |
| ---- | ----------- |
| `paper_searching` | Enrich a Google Scholar result with metadata from arXiv, Semantic Scholar, and Unpaywall |
| `paper_fetching` | Fetch full paper as markdown: cache → local PDF → arxiv2md (→ arxiv PDF fallback) → MinerU |
| `paper_content` | Read cached paper markdown by title (local, no network) |
| `paper_reference` | Get paper references via Semantic Scholar API, fallback to markdown parsing |
| `paper_reading` | AI-powered three-pass paper reader via LLM agent (Keshav method) |

## Setup

```bash
npm install
cp .mcp.example.json .mcp.json
# Fill in your API keys in .mcp.json
```

## Usage

```bash
npm run mcp          # Start MCP server (stdio transport)
npm test             # Run tests
npm run build        # Compile TypeScript
```

## Environment Variables

Configured in `.mcp.json` under the `neocortica-scholar` server's `env` field. See `.mcp.example.json` for a template.

| Variable | Purpose | Required |
| -------- | ------- | -------- |
| `MINERU_TOKEN` | MinerU PDF→markdown API | Yes |
| `EMAIL` | Unpaywall OA PDF lookup | Yes |
| `NEOCORTICA_CACHE` | Cache directory (default: `.cache/`) | No |
| `OPENAI_API_KEY` | LLM API key for paper_reading | For paper_reading |
| `OPENAI_BASE_URL` | LLM API base URL | For paper_reading |
| `OPENAI_MODEL` | LLM model for paper_reading (default: `openai/gpt-oss-120b`) | No |

## Architecture

The typical workflow starts with scraping Google Scholar via an external Apify MCP server, then processes papers through `paper_searching` → `paper_fetching`. Once fetched, papers can be read via `paper_content`, their references explored via `paper_reference`, or analyzed in depth via `paper_reading`.

### paper_searching

Enriches raw Google Scholar results with open access metadata. Priority: arXiv title search → Semantic Scholar title search → Unpaywall DOI lookup. If an `arxivUrl` is already present in the input, enrichment is skipped.

### paper_fetching

Fetches full paper text as markdown with multiple fallback sources. Checks cache first, then tries local PDF (via MinerU), arxiv2md conversion, arxiv PDF via MinerU (fallback when arxiv2md fails), and finally OA PDF URL via MinerU. When using `pdfPath`, title and normalizedTitle are auto-derived from the filename.

### paper_reference

Retrieves all references of a paper. Primary path uses Semantic Scholar API with `s2Id`, `ARXIV:id`, or `DOI:id`. Falls back to parsing the References section from cached markdown when no identifiers are available.

### Known limitations

- **arxiv2md**: Some arXiv papers cannot be converted (complex LaTeX, very long papers). Falls back to arxiv PDF via MinerU.
- **oaPdfUrl via MinerU**: URLs from Unpaywall/SS that are DOI redirects (`doi.org/...`) may resolve to HTML landing pages or paywalls instead of actual PDFs, causing MinerU extraction to fail.

## License

[Apache-2.0 License](LICENSE)
