# Resume upload — what changed

The "Your resume" textarea is replaced by a drag-and-drop file upload. Everything
else in Resume Matcher AI is untouched.

## Flow

1. User drops or picks a PDF/DOCX.
2. Client validates type and size (fast feedback only).
3. File is POSTed to the `extractResumeFromFile` server function as `FormData`.
4. Server re-validates, extracts plain text, returns it.
5. "Analyze match" calls the **existing** `analyzeResumeMatch` server function with
   that text plus the pasted job description. The analysis API was not duplicated.

## Files

| File | Change |
| --- | --- |
| `src/lib/resume-file.ts` | **New.** Shared upload rules: 10MB cap, accepted formats, size/type validation, formatting helpers. Imported by both the component and the server function so they can't disagree. |
| `src/lib/resume-extract.ts` | **New, server only.** PDF and DOCX → plain text using Node's built-in `node:zlib`. No new npm dependency. |
| `src/lib/resume-match.functions.ts` | Added `extractResumeFromFile` (POST, `FormData`). `analyzeResumeMatch` unchanged. |
| `src/components/resume-upload.tsx` | **New.** The drop zone and all of its states. |
| `src/routes/index.tsx` | Textarea swapped for `<ResumeUpload />`; analysis gated on a successful upload; hero and meta copy updated. Results UI unchanged. |
| `src/styles.css` | Appended `@keyframes upload-progress` + matching `@utility` for the indeterminate progress bar. |

## States

`empty`, `drag-over`, `uploading`, `success`, `invalid type`, `file too large`,
`upload error`. The three failure states share one layout but show their own
heading and message. Analysis stays disabled until a file has been uploaded *and*
text was successfully extracted from it.

## Extraction support

- **DOCX** — ZIP reader → `word/document.xml`, preserving paragraphs, tabs, line
  breaks and table rows/cells.
- **PDF** — object scan → FlateDecode / ASCII85 / ASCIIHex / RunLength + PNG
  predictor → object streams → page-tree order → content-stream text operators,
  decoded through each font's ToUnicode CMap or `/Differences` map.
- **.doc** — rejected with a message telling the user to save as .docx or PDF.
  Legacy binary Word is a different format and isn't worth supporting here.
- Scanned / image-only PDFs are detected and rejected with a clear explanation
  rather than sending empty text to the AI.

Verified against PDFs from reportlab, LibreOffice/Word, pdflatex and xelatex;
DOCX from python-docx and LibreOffice, including a two-column table layout; and
failure cases (image-only PDF, corrupt PDF, non-ZIP .docx).

## Running locally with your own API key

The analysis call in `resume-match.functions.ts` reads `LOVABLE_API_KEY` from
`process.env`. On Lovable's hosting that's injected for you; running with
`bun dev` on your own machine, you need to set it yourself:

1. Copy `.env.example` to `.env`.
2. Put your key in: `LOVABLE_API_KEY=your_key_here`.
3. Restart `bun dev` — Bun loads `.env` automatically.

`.env` is git-ignored, so the key stays out of version control.

## Theme note

The brief listed a blue/purple palette (#2563EB, #7C3AED, light background), but
this app's actual theme is dark with an amber `--primary`, defined as oklch tokens
in `styles.css`. To keep the upload section consistent with the rest of the UI it
uses the semantic tokens (`primary`, `destructive`, `success`, `border`, `panel`),
so it follows the theme if the palette is ever changed in `:root`.
