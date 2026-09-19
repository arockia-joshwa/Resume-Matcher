/**
 * Upload rules shared by the client component and the server function, so the
 * browser and the backend can never disagree about what a valid resume is.
 */

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
export const MAX_RESUME_LABEL = "10MB";

/** What the file picker offers. */
export const RESUME_ACCEPT_ATTRIBUTE = [
  ".pdf",
  ".docx",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");

export type ResumeFileErrorKind = "type" | "size";

export type ResumeFileError = { kind: ResumeFileErrorKind; message: string };

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function describeFileType(name: string): string {
  const extension = name.slice(name.lastIndexOf(".") + 1).toUpperCase();
  return extension === "PDF" || extension === "DOCX" ? extension : "Document";
}

/**
 * Returns null when the file is acceptable, otherwise a message written for the
 * person uploading it.
 */
export function validateResumeFile(file: { name: string; size: number }): ResumeFileError | null {
  const name = file.name.toLowerCase();

  if (name.endsWith(".doc")) {
    return {
      kind: "type",
      message:
        "Legacy .doc files aren't supported. Open it in Word and save as .docx, or export it as a PDF.",
    };
  }

  if (!name.endsWith(".pdf") && !name.endsWith(".docx")) {
    return {
      kind: "type",
      message: `That file type isn't supported. Upload your resume as a PDF or DOCX.`,
    };
  }

  if (file.size > MAX_RESUME_BYTES) {
    return {
      kind: "size",
      message: `That file is ${formatFileSize(file.size)}. The limit is ${MAX_RESUME_LABEL} — try exporting a smaller PDF.`,
    };
  }

  if (file.size === 0) {
    return { kind: "type", message: "That file is empty. Pick the file that contains your resume." };
  }

  return null;
}
