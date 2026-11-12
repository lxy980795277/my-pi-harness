/** Validated source metadata and untrusted text shared by host adapters and tools. */
export interface WebSearchItem {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  content: string;
  siteName: string | null;
  siteIcon: string | null;
  date: string | null;
  rerankScore: number;
  authority: number;
}

/** Provider results consumed by host tool formatting, not a public HTTP response. */
export interface WebSearchResult {
  results: WebSearchItem[];
}

/** A page target whose public-network validation belongs to the provider adapter. */
export interface WebPageInput {
  url: string;
}

/** Extracted Markdown and provenance consumed by host tools. */
export interface WebPageResult {
  url: string;
  title: string;
  content: string;
}
