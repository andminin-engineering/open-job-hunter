import type { Profile } from "./profile.js";
import { renderCompetencies } from "./profile.js";

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
    : "senior-level experience";

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

  return `Role: Senior Enterprise Technical Screener & IT Architectural Matcher
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
Analyze the provided job description and contrast it strictly against the profile above. Your goal is to determine the real viability of applying and to build the narrative strategy, returned as JSON.

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
