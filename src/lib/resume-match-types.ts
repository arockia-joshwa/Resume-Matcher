export type MatchResult = {
  candidate: { name: string; current_role: string };
  job: { title: string; company: string };
  overall_score: number;
  score_breakdown: {
    skills: number;
    experience: number;
    keywords: number;
    education: number;
    projects: number;
  };
  summary: string;
  matched_skills: { skill: string; evidence: string }[];
  partial_skills: { skill: string; evidence: string; gap: string }[];
  missing_skills: { skill: string; importance: string; reason: string }[];
  unwanted_skills: {
    skill: string;
    reason: string;
    action: "remove" | "deemphasize" | "move_to_lower_section";
  }[];
  keyword_analysis: { found: string[]; missing: string[]; important_keywords: string[] };
  experience_analysis: { matched_requirements: string[]; gaps: string[]; summary: string };
  education_analysis: { matched: string[]; missing: string[]; summary: string };
  project_analysis: { relevant_projects: string[]; gaps: string[]; summary: string };
  ats_analysis: {
    keyword_coverage: number;
    strengths: string[];
    issues: string[];
    suggestions: string[];
  };
  recommendations: {
    priority: string;
    category: string;
    suggestion: string;
    reason: string;
  }[];
  top_strengths: string[];
  top_gaps: string[];
  final_summary: string;
};
