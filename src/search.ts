/**
 * Remotive's search parameter is a plain substring match: it has no boolean
 * operators, so "software architect OR backend engineer" matches almost
 * nothing. Profiles still express alternatives with OR, so split them into
 * separate queries (capped to stay polite with the public API).
 */
export const MAX_SEARCH_TERMS = 3;

export function splitSearchTerms(search: string, max = MAX_SEARCH_TERMS): string[] {
  const terms = search
    .split(/\s+OR\s+|\s*[|,;]\s*/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  return [...new Set(terms.map((term) => term.toLowerCase()))].slice(0, max);
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * The public Remotive API currently ignores `search` and always returns the
 * same short feed of recent jobs, so results must be filtered locally: a job
 * matches a term when every word of the term appears in its searchable text.
 */
export function matchesSearchTerm(text: string, term: string): boolean {
  const haystack = normalize(text);
  return normalize(term).split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}
