# Neocortica-Scholar

MCP server for academic paper searching, fetching, reading, and reference exploration.

## Architecture (v0.2.0)

Single TypeScript MCP server project.

### Structure

```
src/
  mcp_server.ts          # MCP server — tool registration and orchestration
  types.ts               # PaperMeta, ScholarItem types
  tools/
    paper_searching.ts   # Enrich Scholar results via arXiv/SS/Unpaywall
    paper_fetching.ts    # Fetch paper markdown: cache → arxiv2md → MinerU
    paper_content.ts     # Read cached markdown by title (local, no network)
    paper_reference.ts   # Get references via SS API, fallback to markdown parsing
    paper_reading.ts     # Three-pass paper reader via pi-agent-core
  utils/
    arxiv.ts             # arXiv API: URL/ID conversion, title search, entry parsing
    ss.ts                # Semantic Scholar: title search, references (paginated)
    unpaywall.ts         # Unpaywall: OA PDF URL lookup by DOI
    cache.ts             # Local cache: save/load markdown and meta JSON
    pdf.ts               # MinerU API: PDF → markdown conversion
    agent.ts             # pi-agent-core wrapper for LLM agent loops
    misc.ts              # normTitle() — title normalization
prompt/
  paper-reading.md       # Three-pass Keshav reading method system prompt
.test/                   # Tests mirroring src/ structure
```

## MCP Tools

| Tool | Description |
| ---- | ----------- |
| `paper_searching` | Enrich Google Scholar result with arXiv, Semantic Scholar, Unpaywall metadata (priority: arxiv > SS > Unpaywall) |
| `paper_fetching` | Fetch paper as markdown: cache → local PDF → arxiv2md → MinerU |
| `paper_content` | Read cached paper markdown content by title (local, no network) |
| `paper_reference` | Get paper references via SS API, fallback to markdown parsing |
| `paper_reading` | Three-pass paper reader via pi-agent-core (Keshav method) |

### Pipeline: paper_searching

```
input → <has arxivUrl?> ── yes → done
              │ no
              ▼
    <arXiv title search?> ── yes → arxivUrl → done
              │ no
              ▼
    <SS title search?> ── yes → <Unpaywall DOI lookup> → oaPdfUrl
              │ no                      │ no
              ▼                         ▼
            null                      done
```

Priority: arxiv > SS > Unpaywall.

### Pipeline: paper_fetching

```
input → cache hit? ── yes → return cached
            │ no
            ▼
    pdfPath? ── yes → MinerU (local PDF)
            │ no
            ▼
    arxivUrl? ── yes → arxiv2md
            │ no
            ▼
    oaPdfUrl? ── yes → MinerU (remote PDF)
            │ no
            ▼
    return without markdownPath
```

## Development Methodology: Incremental + Carpet-Bombing Tests

**MANDATORY** — all projects under Neocortica follow this development methodology:

1. **Single-file component** → immediately write unit tests, run and pass before moving on
2. **Multiple components form a feature** → immediately write feature-level integration tests
3. **Multiple features form a module** → immediately write module-level tests
4. **ALL prior tests must pass** before developing the next component — no exceptions
5. **Simulation tests required** — generate realistic fake data (API responses, edge cases, malformed inputs) and verify under realistic conditions
6. **Test files** live in `.test/` mirroring `src/` structure (e.g., `.test/tools/paper_fetching.test.ts`)
7. **Gate rule**: if any test fails, STOP. Fix the failure before writing new code
8. **Test data prefix**: use `zztest_` prefix for all test artifacts, clean up in `afterEach`
9. **No temporary directories**: tests use real `DIR_CACHE` from `.env`

## Key Conventions

- Output filenames: lowercase, non-alphanum → `_`, no trailing `_` (see `normTitle()`)
- Cache: `DIR_CACHE` from `.env` (default `.cache/`), subdirs `markdown/`, `paper/`, `pdf/`
- Local PDFs go in `.cache/pdf/`; `paper_fetching` with `pdfPath` auto-derives title/normalizedTitle from filename
- `oaPdfUrl` sourcing: only from Semantic Scholar `openAccessPdf` or Unpaywall — never from Scholar `documentLink`

## Dev Commands

```bash
npm install               # Install dependencies
npm run mcp               # Run MCP server (tsx src/mcp_server.ts)
npm test                  # Run tests (tsx --test .test/**/*.test.ts)
npm run build             # TypeScript build
```

## Environment

- Node.js (ESM, `tsx` for TS execution), npm
- `.env` holds `DIR_CACHE`, `TOKEN_MINERU`, `TOKEN_APIFY`, `EMAIL_UNPAYWALL`
- Optional: `AGENT_MODEL` (default `openai/gpt-oss-120b`), `OPENROUTER_API_KEY`
