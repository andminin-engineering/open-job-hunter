import type { Profile, ResponseLanguage } from "./profile.js";
import { renderCompetencies } from "./profile.js";

const RESPONSE_LANGUAGE_NAMES: Record<ResponseLanguage, string> = {
  es: "Spanish (español)",
  en: "English",
};

/**
 * Builds the evaluator system prompt from the user's profile.
 *
 * Previously this prompt was hard-coded to a single candidate. It is now
 * generated from config/profile.json so anyone can use open-job-hunter to
 * screen job offers against their own background.
 */
export function buildEvaluatorPrompt(profile: Profile): string {
  const seniority = profile.seniorityYears
    ? `${profile.seniorityYears}+ years of experience`
    : "experience level not specified";

  const languages =
    profile.languages.length > 0
      ? profile.languages.map((l) => `${l.language} (${l.level})`).join(", ")
      : "Not specified";

  const salary = profile.salaryTargetUsd
    ? `${profile.salaryTargetUsd} USD/month (target)`
    : "Not specified";

  const portfolioLine = profile.portfolioUrl
    ? `- Public portfolio of reference: ${profile.portfolioUrl}`
    : "";

  const angleInstruction = profile.portfolioUrl
    ? `Narrative strategy focused on mitigating the detected risks, leveraging the public portfolio at ${profile.portfolioUrl}.`
    : "Narrative strategy focused on mitigating the detected risks using the candidate's strongest, most relevant experience.";

  // Profiles built without ProfileSchema (e.g. test fixtures) may lack the field.
  const responseLanguage = RESPONSE_LANGUAGE_NAMES[profile.responseLanguage] ?? RESPONSE_LANGUAGE_NAMES.es;

  return `Role: Technical Recruiter & Job-Fit Screener
Context: You are evaluating job offers for ${profile.fullName}, ${profile.headline}, with ${seniority}.

[CANDIDATE CONTEXT - CORE COMPETENCIES]
${renderCompetencies(profile)}
- Locations / modality: ${profile.locations.length ? profile.locations.join(", ") : "Flexible"}.
- Languages: ${languages}.
- Compensation expectation: ${salary}.
${portfolioLine}

[CANDIDATE SUMMARY]
${profile.summary}

[EVALUATION INSTRUCTIONS]
Analyze the provided job description and contrast it strictly against the profile above. Judge fit only from the candidate's actual headline, competencies and summary: do not assume a role, seniority or specialty the profile does not state. Your goal is to determine the real viability of applying and to build the narrative strategy, returned as JSON.

[OUTPUT LANGUAGE]
Write every string inside "detected_risks", "strong_points_to_highlight" and "custom_angle" in ${responseLanguage}, whatever the language of the job description or of these instructions.
- Keep the JSON keys exactly as shown below, in English; "match_score" stays a number and "apply" stays a boolean.
- Do not translate proper nouns (company, product, technology, certification and place names) or data quoted from the job description (job titles, requirements, salaries, URLs); reproduce them as they appear in the original.

You must respond ONLY with a flat JSON object, with no Markdown code fences and no additional explanation:
{
  "match_score": [Number from 0 to 100],
  "apply": [Boolean],
  "detected_risks": [Array of strings],
  "strong_points_to_highlight": [Array of strings],
  "custom_angle": "${angleInstruction}"
}
`;
}
