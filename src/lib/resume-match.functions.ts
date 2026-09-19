import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { MatchResult } from "./resume-match-types";
import { MAX_RESUME_BYTES, validateResumeFile } from "./resume-file";

const Input = z.object({
  resumeText: z.string().min(30, "Please paste a longer resume."),
  jobDescription: z.string().min(30, "Please paste a longer job description."),
});

export type UploadedResume = {
  fileName: string;
  fileSize: number;
  text: string;
  characters: number;
  words: number;
};

/**
 * Step 1 of the flow: the browser POSTs the actual PDF/DOCX here, the server
 * turns it into plain text and hands that text back. `analyzeResumeMatch`
 * below is then called with the extracted text exactly as before — the
 * analysis endpoint is reused, not duplicated.
 */
export const extractResumeFromFile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("Expected a resume file upload.");
    return data;
  })
  .handler(async ({ data }): Promise<UploadedResume> => {
    const file = data.get("resume");

    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      throw new Error("No resume file was received. Please choose your file again.");
    }

    const name = typeof file.name === "string" ? file.name : "resume";
    const size = typeof file.size === "number" ? file.size : 0;

    // Re-validate server side: the client checks are for fast feedback only.
    const invalid = validateResumeFile({ name, size });
    if (invalid) throw new Error(invalid.message);
    if (size > MAX_RESUME_BYTES) throw new Error("That file is too large to process.");

    const { extractResumeText, ResumeExtractionError } = await import("./resume-extract");

    try {
      const extracted = await extractResumeText(file as File);
      return { fileName: name, fileSize: size, ...extracted };
    } catch (error) {
      if (error instanceof ResumeExtractionError) throw new Error(error.message);
      console.error(error);
      throw new Error("We couldn't read that file. Try re-exporting it as a PDF or DOCX.");
    }
  });

const SYSTEM_PROMPT = `You are Resume Matcher AI, an expert ATS resume analyzer and career-document matching engine.

Analyze a candidate's resume against a specific job description and produce an objective, evidence-based compatibility analysis.

IMPORTANT RULES:
1. Analyze ONLY the information provided in the resume and job description.
2. Never invent candidate skills, experience, education, certifications, projects, companies, achievements, metrics, or technologies.
3. Never assume a candidate has a skill simply because it is related to another skill.
4. Distinguish between explicitly mentioned, clearly implied, and not found.
5. Do not penalize missing information unless it is relevant to the job requirements.
6. Treat genuinely equivalent terminology carefully (for example, JavaScript and JS), but never treat unrelated technologies as equivalent.
7. Separate required qualifications from preferred qualifications.
8. Consider the context in which a skill is used, not just keyword presence.
9. Give short evidence from the resume for important conclusions.
10. Keep the analysis factual and neutral. Do not make hiring decisions or predict whether the candidate will be hired.
11. Recommendations must only suggest truthful improvements. Never suggest adding skills, metrics, certifications, projects, or achievements the candidate does not actually have.
12. Never recommend keyword stuffing.
13. "Unwanted skills" means skills/technologies that are present in the resume but are low-relevance, redundant, outdated, or distracting for THIS specific job. Do not call a skill unwanted merely because it is not mentioned in the job description. Explain why it may be better to remove, shorten, or move it to a lower-priority section.
14. Do not recommend removing a skill when it is clearly relevant to the target role.
15. The match percentage must reflect the evidence in the supplied resume and job description. It is an analytical estimate, not a hiring probability.
16. Prefer concise, actionable suggestions that the candidate can actually follow.

PROCESS:
A. Extract resume details: name, current role, skills, experience, projects, education, certifications, tools, achievements, and domains.
B. Extract job details: title, company, required/preferred skills, experience, education, certifications, responsibilities, tools, domain knowledge, soft skills, and important ATS keywords.
C. Classify important requirements as MATCHED, PARTIAL, or MISSING with evidence.
D. Identify resume skills that are relevant, partially relevant, missing, and potentially unwanted/low-value for this particular job.
E. Compare keywords semantically and identify important missing keywords without encouraging keyword stuffing.
F. Analyze experience, education, projects, ATS readability, and resume relevance.
G. Calculate an overall score from 0-100, giving more weight to required qualifications than preferred qualifications.
H. Give prioritized recommendations, top strengths, top gaps, and a concise final action plan.

OUTPUT:
Return ONLY one valid JSON object. Do not use markdown fences, comments, or extra text. The JSON must match exactly this structure:
{
  "candidate": { "name": "", "current_role": "" },
  "job": { "title": "", "company": "" },
  "overall_score": 0,
  "score_breakdown": {
    "skills": 0,
    "experience": 0,
    "keywords": 0,
    "education": 0,
    "projects": 0
  },
  "summary": "",
  "matched_skills": [{ "skill": "", "evidence": "" }],
  "partial_skills": [{ "skill": "", "evidence": "", "gap": "" }],
  "missing_skills": [{ "skill": "", "importance": "required|preferred", "reason": "" }],
  "unwanted_skills": [{ "skill": "", "reason": "", "action": "remove|deemphasize|move_to_lower_section" }],
  "keyword_analysis": {
    "found": [],
    "missing": [],
    "important_keywords": []
  },
  "experience_analysis": {
    "matched_requirements": [],
    "gaps": [],
    "summary": ""
  },
  "education_analysis": {
    "matched": [],
    "missing": [],
    "summary": ""
  },
  "project_analysis": {
    "relevant_projects": [],
    "gaps": [],
    "summary": ""
  },
  "ats_analysis": {
    "keyword_coverage": 0,
    "strengths": [],
    "issues": [],
    "suggestions": []
  },
  "recommendations": [{
    "priority": "high|medium|low",
    "category": "summary|skills|experience|projects|keywords|format",
    "suggestion": "",
    "reason": ""
  }],
  "top_strengths": [],
  "top_gaps": [],
  "final_summary": ""
}
All scores must be integers from 0 to 100. Use empty strings or empty arrays when information is not available.`;

const GROQ_MODEL = process.env["GROQ_MODEL"] || "openai/gpt-oss-120b";

const MatchResultSchema = z.object({
  candidate: z.object({
    name: z.string(),
    current_role: z.string(),
  }),
  job: z.object({
    title: z.string(),
    company: z.string(),
  }),
  overall_score: z.number().int().min(0).max(100),
  score_breakdown: z.object({
    skills: z.number().int().min(0).max(100),
    experience: z.number().int().min(0).max(100),
    keywords: z.number().int().min(0).max(100),
    education: z.number().int().min(0).max(100),
    projects: z.number().int().min(0).max(100),
  }),
  summary: z.string(),
  matched_skills: z.array(z.object({ skill: z.string(), evidence: z.string() })),
  partial_skills: z.array(
    z.object({ skill: z.string(), evidence: z.string(), gap: z.string() }),
  ),
  missing_skills: z.array(
    z.object({
      skill: z.string(),
      importance: z.enum(["required", "preferred"]),
      reason: z.string(),
    }),
  ),
  unwanted_skills: z.array(
    z.object({
      skill: z.string(),
      reason: z.string(),
      action: z.enum(["remove", "deemphasize", "move_to_lower_section"]),
    }),
  ),
  keyword_analysis: z.object({
    found: z.array(z.string()),
    missing: z.array(z.string()),
    important_keywords: z.array(z.string()),
  }),
  experience_analysis: z.object({
    matched_requirements: z.array(z.string()),
    gaps: z.array(z.string()),
    summary: z.string(),
  }),
  education_analysis: z.object({
    matched: z.array(z.string()),
    missing: z.array(z.string()),
    summary: z.string(),
  }),
  project_analysis: z.object({
    relevant_projects: z.array(z.string()),
    gaps: z.array(z.string()),
    summary: z.string(),
  }),
  ats_analysis: z.object({
    keyword_coverage: z.number().int().min(0).max(100),
    strengths: z.array(z.string()),
    issues: z.array(z.string()),
    suggestions: z.array(z.string()),
  }),
  recommendations: z.array(
    z.object({
      priority: z.enum(["high", "medium", "low"]),
      category: z.enum(["summary", "skills", "experience", "projects", "keywords", "format"]),
      suggestion: z.string(),
      reason: z.string(),
    }),
  ),
  top_strengths: z.array(z.string()),
  top_gaps: z.array(z.string()),
  final_summary: z.string(),
});

export const analyzeResumeMatch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<MatchResult> => {
    const apiKey = process.env["GROQ_API_KEY"];
    if (!apiKey) {
      throw new Error(
        "Groq AI is not configured. Add GROQ_API_KEY to your server .env file and restart the app.",
      );
    }

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        max_completion_tokens: 12000,
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content:
              `RESUME:\\n${data.resumeText}\\n\\nJOB DESCRIPTION:\\n${data.jobDescription}\\n\\n` +
              "Compare the resume with this job description and return only the JSON object requested by the system instructions.",
          },
        ],
        response_format: {
          type: "json_object",
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 401) {
        throw new Error("Groq API key is invalid or not authorized. Check GROQ_API_KEY.");
      }
      if (res.status === 403) {
        throw new Error(
          `Groq denied access to model "${GROQ_MODEL}". Set GROQ_MODEL to a model available to your Groq account.`,
        );
      }
      if (res.status === 404) {
        throw new Error(
          `Groq model "${GROQ_MODEL}" was not found. Check GROQ_MODEL or use an active model from Groq.`,
        );
      }
      if (res.status === 429) {
        throw new Error("Groq is rate-limiting the request. Please wait a moment and try again.");
      }
      throw new Error(`Analysis failed (${res.status}). ${detail.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      throw new Error("Groq returned an empty result. Please try again.");
    }

    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          parsed = JSON.parse(cleaned.slice(start, end + 1));
        } catch {
          throw new Error("Groq returned an unreadable JSON result. Please try again.");
        }
      } else {
        throw new Error("Groq returned an unreadable result. Please try again.");
      }
    }

    const validated = MatchResultSchema.safeParse(parsed);
    if (!validated.success) {
      console.error("Invalid Groq resume-match response:", validated.error.flatten());
      throw new Error("Groq returned an incomplete analysis. Please try again.");
    }

    return validated.data as MatchResult;
  });
