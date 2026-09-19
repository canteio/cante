/** Values shared by upload validation and machine-readable discovery. */
export const EXTRACTED_FILE_FORMATS = ["text", "csv", "xlsx", "docx", "pdf"] as const;
export type ExtractedFormat = (typeof EXTRACTED_FILE_FORMATS)[number];

/** Keep limits outside parser modules so discovery never initializes a parser or storage. */
export const MAX_EXTRACTED_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_EXTRACTED_TEXT_CHARS = 20_000;
