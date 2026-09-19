import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { analyzeResumeMatch, extractResumeFromFile } from "@/lib/resume-match.functions";
import type { UploadedResume } from "@/lib/resume-match.functions";
import type { MatchResult } from "@/lib/resume-match-types";
import { validateResumeFile } from "@/lib/resume-file";
import { ResumeUpload, type ResumeUploadState } from "@/components/resume-upload";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Resume Matcher AI — ATS Resume & Job Match Analysis" },
      {
        name: "description",
        content:
          "Upload your resume as a PDF or DOCX, paste a job description, and get an evidence-based ATS match score, skill gaps and truthful improvement tips.",
      },
      { property: "og:title", content: "Resume Matcher AI — ATS Resume & Job Match Analysis" },
      {
        property: "og:description",
        content:
          "Evidence-based resume vs job description analysis: match score, matched and missing skills, keyword coverage and improvements.",
      },
    ],
  }),
  component: Index,
});

function scoreTone(score: number) {
  if (score >= 75) return "text-success";
  if (score >= 50) return "text-warning";
  return "text-destructive";
}

function Meter({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value ?? 0)));
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-semibold ${scoreTone(v)}`}>{v}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border bg-card p-5 shadow-panel ${className}`}
    >
      <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      <div className="mt-4 space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Chips({ items, tone = "muted" }: { items?: string[]; tone?: "muted" | "good" | "bad" }) {
  if (!items?.length) return <p className="text-muted-foreground">None identified.</p>;
  const cls =
    tone === "good"
      ? "border-success/40 bg-success/10 text-success"
      : tone === "bad"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border bg-secondary text-secondary-foreground";
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className={`rounded-md border px-2 py-1 text-xs ${cls}`}>
          {item}
        </span>
      ))}
    </div>
  );
}

function List({ items }: { items?: string[] }) {
  if (!items?.length) return <p className="text-muted-foreground">None identified.</p>;
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Index() {
  const [resumeText, setResumeText] = useState("");
  const [upload, setUpload] = useState<ResumeUploadState>({ status: "empty" });
  const [jobDescription, setJobDescription] = useState("");

  const analyze = useServerFn(analyzeResumeMatch);
  const extract = useServerFn(extractResumeFromFile);

  const mutation = useMutation<MatchResult, Error, { resumeText: string; jobDescription: string }>({
    mutationFn: (data) => analyze({ data }),
  });

  const uploadMutation = useMutation<UploadedResume, Error, File>({
    mutationFn: (file) => {
      const formData = new FormData();
      formData.append("resume", file);
      return extract({ data: formData });
    },
  });

  const handleFileSelected = (file: File) => {
    const meta = { name: file.name, size: file.size };

    // Fast client-side checks first — type, then size.
    const invalid = validateResumeFile(meta);
    if (invalid) {
      setResumeText("");
      mutation.reset();
      setUpload({ status: "error", kind: invalid.kind, message: invalid.message, file: meta });
      return;
    }

    setResumeText("");
    mutation.reset();
    setUpload({ status: "uploading", file: meta });

    uploadMutation.mutate(file, {
      onSuccess: (data) => {
        setResumeText(data.text);
        setUpload({
          status: "success",
          file: meta,
          characters: data.characters,
          words: data.words,
        });
      },
      onError: (error) => {
        setResumeText("");
        setUpload({ status: "error", kind: "upload", message: error.message, file: meta });
      },
    });
  };

  const handleRemove = () => {
    setResumeText("");
    setUpload({ status: "empty" });
    mutation.reset();
  };

  const resumeReady = upload.status === "success" && resumeText.length >= 30;
  const result = mutation.data;

  return (
    <main className="min-h-screen bg-hero pb-20">
      <div className="mx-auto w-full max-w-6xl px-5 pt-14">
        <header className="max-w-2xl">
          <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-widest text-primary">
            Resume Matcher AI
          </span>
          <h1 className="mt-5 text-4xl font-bold leading-tight sm:text-5xl">
            See how your resume reads against one specific job
          </h1>
          <p className="mt-4 text-base text-muted-foreground">
            Upload your resume and paste the job posting. You get a match score, evidence for every
            matched skill, the gaps that matter, and honest suggestions — nothing invented.
          </p>
        </header>

        <form
          className="mt-10 grid gap-5 lg:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate({ resumeText, jobDescription });
          }}
        >
          <ResumeUpload
            state={upload}
            onFileSelected={handleFileSelected}
            onRemove={handleRemove}
          />
          <div className="rounded-xl border border-border bg-card p-4 shadow-panel">
            <label htmlFor="job" className="text-sm font-semibold">
              Job description
            </label>
            <textarea
              id="job"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the job posting, including requirements…"
              className="mt-3 h-72 w-full resize-y rounded-lg border border-input bg-background p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring/40"
            />
          </div>

          <div className="lg:col-span-2 flex flex-wrap items-center gap-4">
            <button
              type="submit"
              disabled={
                mutation.isPending ||
                upload.status === "uploading" ||
                !resumeReady ||
                jobDescription.length < 30
              }
              className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {mutation.isPending ? "Analyzing…" : "Analyze match"}
            </button>
            {mutation.isPending ? (
              <span className="text-sm text-muted-foreground">
                Reading both documents carefully — this can take a minute.
              </span>
            ) : (
              !resumeReady && (
                <span className="text-sm text-muted-foreground">
                  Upload your resume to enable analysis.
                </span>
              )
            )}
            {mutation.isError && (
              <span className="text-sm text-destructive">{mutation.error.message}</span>
            )}
          </div>
        </form>

        {result && (
          <div className="mt-14 space-y-5">
            <section className="grid gap-5 rounded-xl border border-border bg-card p-6 shadow-panel lg:grid-cols-[220px_1fr]">
              <div className="flex flex-col items-center justify-center rounded-lg bg-panel p-6">
                <span className={`text-6xl font-bold ${scoreTone(result.overall_score)}`}>
                  {result.overall_score}
                </span>
                <span className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">
                  Overall match
                </span>
              </div>
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold">
                    {result.job?.title || "Role"}
                    {result.job?.company ? ` · ${result.job.company}` : ""}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {result.candidate?.name || "Candidate"}
                    {result.candidate?.current_role ? ` — ${result.candidate.current_role}` : ""}
                  </p>
                </div>
                <p className="text-sm leading-relaxed">{result.summary}</p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Meter label="Skills" value={result.score_breakdown?.skills} />
                  <Meter label="Experience" value={result.score_breakdown?.experience} />
                  <Meter label="Keywords" value={result.score_breakdown?.keywords} />
                  <Meter label="Education" value={result.score_breakdown?.education} />
                  <Meter label="Projects" value={result.score_breakdown?.projects} />
                  <Meter label="ATS coverage" value={result.ats_analysis?.keyword_coverage} />
                </div>
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Matched skills">
                {result.matched_skills?.length ? (
                  <ul className="space-y-3">
                    {result.matched_skills.map((s, i) => (
                      <li key={i} className="rounded-lg bg-panel p-3">
                        <p className="font-medium text-success">{s.skill}</p>
                        <p className="mt-1 text-muted-foreground">{s.evidence}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">None identified.</p>
                )}
              </Panel>

              <Panel title="Partial matches">
                {result.partial_skills?.length ? (
                  <ul className="space-y-3">
                    {result.partial_skills.map((s, i) => (
                      <li key={i} className="rounded-lg bg-panel p-3">
                        <p className="font-medium text-warning">{s.skill}</p>
                        <p className="mt-1 text-muted-foreground">{s.evidence}</p>
                        <p className="mt-1">Gap: {s.gap}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">None identified.</p>
                )}
              </Panel>

              <Panel title="Missing requirements">
                {result.missing_skills?.length ? (
                  <ul className="space-y-3">
                    {result.missing_skills.map((s, i) => (
                      <li key={i} className="rounded-lg bg-panel p-3">
                        <p className="font-medium text-destructive">
                          {s.skill}
                          <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                            {s.importance}
                          </span>
                        </p>
                        <p className="mt-1 text-muted-foreground">{s.reason}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">None identified.</p>
                )}
              </Panel>

              <Panel title="Unwanted / Low-Relevance Skills">
                <p className="text-xs text-muted-foreground">
                  These are skills already present in the resume that may distract from this specific
                  job. Do not remove anything that is genuinely relevant to the target role.
                </p>
                {result.unwanted_skills?.length ? (
                  <ul className="space-y-3">
                    {result.unwanted_skills.map((s, i) => (
                      <li key={i} className="rounded-lg bg-panel p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{s.skill}</p>
                          <span className="rounded border border-border px-1.5 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                            {s.action.replaceAll("_", " ")}
                          </span>
                        </div>
                        <p className="mt-1 text-muted-foreground">{s.reason}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    No clearly irrelevant or distracting skills identified.
                  </p>
                )}
              </Panel>

              <Panel title="Keywords">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Found</p>
                <Chips items={result.keyword_analysis?.found} tone="good" />
                <p className="pt-2 text-xs uppercase tracking-widest text-muted-foreground">
                  Missing
                </p>
                <Chips items={result.keyword_analysis?.missing} tone="bad" />
                <p className="pt-2 text-xs uppercase tracking-widest text-muted-foreground">
                  Important for this role
                </p>
                <Chips items={result.keyword_analysis?.important_keywords} />
              </Panel>

              <Panel title="Experience">
                <p className="text-muted-foreground">{result.experience_analysis?.summary}</p>
                <p className="pt-1 text-xs uppercase tracking-widest text-muted-foreground">
                  Matched
                </p>
                <List items={result.experience_analysis?.matched_requirements} />
                <p className="pt-1 text-xs uppercase tracking-widest text-muted-foreground">Gaps</p>
                <List items={result.experience_analysis?.gaps} />
              </Panel>

              <Panel title="Education & certifications">
                <p className="text-muted-foreground">{result.education_analysis?.summary}</p>
                <p className="pt-1 text-xs uppercase tracking-widest text-muted-foreground">
                  Matched
                </p>
                <Chips items={result.education_analysis?.matched} tone="good" />
                <p className="pt-1 text-xs uppercase tracking-widest text-muted-foreground">
                  Missing
                </p>
                <Chips items={result.education_analysis?.missing} tone="bad" />
              </Panel>

              <Panel title="Projects">
                <p className="text-muted-foreground">{result.project_analysis?.summary}</p>
                <List items={result.project_analysis?.relevant_projects} />
                <p className="pt-1 text-xs uppercase tracking-widest text-muted-foreground">Gaps</p>
                <List items={result.project_analysis?.gaps} />
              </Panel>

              <Panel title="ATS readability">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Strengths</p>
                <List items={result.ats_analysis?.strengths} />
                <p className="pt-1 text-xs uppercase tracking-widest text-muted-foreground">
                  Issues
                </p>
                <List items={result.ats_analysis?.issues} />
                <p className="pt-1 text-xs uppercase tracking-widest text-muted-foreground">
                  Suggestions
                </p>
                <List items={result.ats_analysis?.suggestions} />
              </Panel>
            </div>

            <Panel title="Recommendations">
              {result.recommendations?.length ? (
                <ul className="space-y-3">
                  {result.recommendations.map((r, i) => (
                    <li key={i} className="rounded-lg bg-panel p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide">
                        <span
                          className={`rounded px-2 py-0.5 font-semibold ${
                            r.priority === "high"
                              ? "bg-destructive/15 text-destructive"
                              : r.priority === "medium"
                                ? "bg-warning/15 text-warning"
                                : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {r.priority}
                        </span>
                        <span className="text-muted-foreground">{r.category}</span>
                      </div>
                      <p className="mt-2 font-medium">{r.suggestion}</p>
                      <p className="mt-1 text-muted-foreground">{r.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">None provided.</p>
              )}
            </Panel>

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Top strengths">
                <List items={result.top_strengths} />
              </Panel>
              <Panel title="Top gaps">
                <List items={result.top_gaps} />
              </Panel>
            </div>

            <Panel title="Final summary">
              <p>{result.final_summary}</p>
            </Panel>
          </div>
        )}
      </div>
    </main>
  );
}
