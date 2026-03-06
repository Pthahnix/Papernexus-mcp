import type { PaperMeta } from "../types.js";

/**
 * paper_reading tool (stub): AI-powered paper reader.
 * Not yet implemented — returns placeholder.
 */
export async function paperReading(
  _markdownPath: string,
  _instructions?: string,
): Promise<{ status: string; message: string }> {
  return {
    status: "not_implemented",
    message: "paper_reading is not yet implemented. Use paper_fetching to get the markdown and read it directly.",
  };
}
