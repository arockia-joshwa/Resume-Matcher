import { useId, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  UploadCloud,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  MAX_RESUME_LABEL,
  RESUME_ACCEPT_ATTRIBUTE,
  describeFileType,
  formatFileSize,
  type ResumeFileErrorKind,
} from "@/lib/resume-file";

export type ResumeFileMeta = { name: string; size: number };

export type ResumeUploadState =
  | { status: "empty" }
  | { status: "uploading"; file: ResumeFileMeta }
  | { status: "success"; file: ResumeFileMeta; characters: number; words: number }
  | {
      status: "error";
      kind: ResumeFileErrorKind | "upload";
      message: string;
      file?: ResumeFileMeta;
    };

type Props = {
  state: ResumeUploadState;
  onFileSelected: (file: File) => void;
  onRemove: () => void;
};

const ERROR_TITLES: Record<ResumeFileErrorKind | "upload", string> = {
  type: "Unsupported file type",
  size: "File is too large",
  upload: "We couldn't read that file",
};

export function ResumeUpload({ state, onFileSelected, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const describedBy = useId();

  const openPicker = () => inputRef.current?.click();

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFileSelected(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  const isBusy = state.status === "uploading";
  const hasError = state.status === "error";

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">Your resume</span>
        <span className="text-xs text-muted-foreground">PDF or DOCX · Max {MAX_RESUME_LABEL}</span>
      </div>

      <input
        ref={inputRef}
        id="resume-file"
        type="file"
        accept={RESUME_ACCEPT_ATTRIBUTE}
        className="sr-only"
        onChange={(event) => handleFiles(event.target.files)}
      />

      {state.status === "success" ? (
        <div className="mt-3">
          <div className="flex flex-col gap-4 rounded-lg border border-success/40 bg-success/5 p-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                <FileText className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={state.file.name}>
                  {state.file.name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {describeFileType(state.file.name)} · {formatFileSize(state.file.size)} ·{" "}
                  {state.characters.toLocaleString()} characters read
                </p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  Ready to analyze
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={onRemove}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition-colors hover:bg-secondary sm:flex-none"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Remove
              </button>
              <button
                type="button"
                onClick={openPicker}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/50 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 sm:flex-none"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Replace
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={isBusy ? -1 : 0}
          aria-disabled={isBusy}
          aria-describedby={describedBy}
          onClick={() => !isBusy && openPicker()}
          onKeyDown={(event) => {
            if (isBusy) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openPicker();
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            if (isBusy) return;
            dragDepth.current += 1;
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault();
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setIsDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            dragDepth.current = 0;
            setIsDragging(false);
            if (!isBusy) handleFiles(event.dataTransfer.files);
          }}
          className={cn(
            "mt-3 flex min-h-[18rem] flex-col items-center justify-center rounded-lg border-2 border-dashed px-5 py-8 text-center transition-colors outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring/60",
            isBusy
              ? "cursor-wait border-border bg-panel"
              : "cursor-pointer border-input bg-background hover:border-primary/60 hover:bg-panel",
            isDragging && !isBusy && "border-primary bg-primary/10",
            hasError && !isDragging && "border-destructive/60 bg-destructive/5",
          )}
        >
          {isBusy ? (
            <div className="w-full max-w-sm">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" aria-hidden />
              <p className="mt-4 truncate text-sm font-medium" title={state.file.name}>
                {state.file.name}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {describeFileType(state.file.name)} · {formatFileSize(state.file.size)}
              </p>
              <div
                className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-label="Uploading resume"
              >
                <div className="h-full w-1/3 rounded-full bg-primary animate-upload-progress" />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Uploading and reading your resume…
              </p>
            </div>
          ) : (
            <>
              <span
                className={cn(
                  "flex h-14 w-14 items-center justify-center rounded-xl",
                  hasError
                    ? "bg-destructive/15 text-destructive"
                    : isDragging
                      ? "bg-primary/20 text-primary"
                      : "bg-panel text-primary",
                )}
              >
                {hasError ? (
                  <AlertTriangle className="h-7 w-7" aria-hidden />
                ) : isDragging ? (
                  <UploadCloud className="h-7 w-7" aria-hidden />
                ) : (
                  <FileText className="h-7 w-7" aria-hidden />
                )}
              </span>

              <h3 className="mt-4 text-base font-semibold">
                {isDragging
                  ? "Drop it here"
                  : hasError
                    ? ERROR_TITLES[state.kind]
                    : "Upload your resume"}
              </h3>

              <p
                id={describedBy}
                className={cn(
                  "mt-2 max-w-sm text-sm",
                  hasError ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {hasError ? state.message : "Drag & drop your resume here, or click to browse"}
              </p>

              {!hasError && (
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF or DOCX • Max {MAX_RESUME_LABEL}
                </p>
              )}

              {hasError && state.file && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {state.file.name} · {formatFileSize(state.file.size)}
                </p>
              )}

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openPicker();
                }}
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <UploadCloud className="h-4 w-4" aria-hidden />
                {hasError ? "Choose another file" : "Browse files"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
