export interface PaperMeta {
  title: string;
  normalizedTitle: string;
  // identifiers
  arxivId?: string;
  doi?: string;
  s2Id?: string;
  // metadata
  abstract?: string;
  arxivUrl?: string;
  oaPdfUrl?: string;
  pdfPath?: string;
  year?: number;
  authors?: string;
  citationCount?: number;
  sourceUrl?: string;
  // cache
  markdownPath?: string;
}
