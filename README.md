# papernexus-mcp

MCP server for academic paper searching, fetching, and reference exploration.

## Tools

| Tool | Description |
| ------ | ------------- |
| `paper_searching` | Enrich Google Scholar results with metadata from Semantic Scholar, arXiv, Unpaywall |
| `paper_fetching` | Fetch full paper as markdown (cache-first, arxiv2md or MinerU PDF conversion) |
| `paper_references` | Extract cited references from paper markdown, enrich each with metadata |
| `paper_reading` | AI-powered paper reader (not yet implemented) |

## Setup

```bash
npm install
cp .env.example .env
# Fill in your API keys in .env
```

## Usage

```bash
npm run mcp          # Start MCP server (stdio transport)
npm test             # Run tests
npm run build        # Compile TypeScript
```

## Environment Variables

| Variable | Purpose | Required |
| ---------- | --------- | ---------- |
| `TOKEN_MINERU` | MinerU PDF OCR API | Yes |
| `EMAIL_UNPAYWALL` | Unpaywall OA lookup | Yes |
| `DIR_CACHE` | Cache directory (default: `.cache/`) | No |

## Architecture

```text
apify MCP (external) → paper_searching → paper_fetching → paper_reading
                                                        ↗
                                          paper_references → loop
```

- **paper_searching** does NOT call apify — apify is invoked at the skill/orchestration layer
- **paper_fetching** does NOT search — it only accepts PaperMeta with existing URLs
- **paper_references** reuses paper_searching logic at code level

## License

Apache License 2.0
