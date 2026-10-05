import { isDeepStrictEqual } from "node:util";

/**
 * Earlier versions wrote the whole scheduler configuration, including these
 * hard-coded sources, into scheduler-config.json whenever the digest email
 * was saved. They are not user choices and must not shadow the profile.
 */
export const LEGACY_DEFAULT_REMOTIVE_SEARCH = "software architect OR delivery lead OR backend java senior";

export const LEGACY_DEFAULT_GREENHOUSE = [
  { board: "stripe", company: "Stripe", limit: 8 },
  { board: "coinbase", company: "Coinbase", limit: 8 },
  { board: "datadog", company: "Datadog", limit: 8 },
  { board: "figma", company: "Figma", limit: 8 },
  { board: "asana", company: "Asana", limit: 8 },
  { board: "mongodb", company: "MongoDB", limit: 8 },
];

export const LEGACY_DEFAULT_LEVER = [
  { company: "lever", companyLabel: "Lever", limit: 6 },
];

/**
 * Removes the sources that a legacy save copied from the old defaults while
 * keeping any source the user changed. The legacy Remotive search marks a
 * file written by an earlier version; without it nothing is touched.
 */
export function stripLegacySchedulerDefaults(overrides: Record<string, any>): Record<string, any> {
  const core = overrides.core;
  if (core?.remotive?.search !== LEGACY_DEFAULT_REMOTIVE_SEARCH) return overrides;

  const nextCore = { ...core };
  delete nextCore.remotive;
  if (isDeepStrictEqual(nextCore.greenhouse, LEGACY_DEFAULT_GREENHOUSE)) delete nextCore.greenhouse;
  if (isDeepStrictEqual(nextCore.lever, LEGACY_DEFAULT_LEVER)) delete nextCore.lever;

  const next = { ...overrides };
  const hasCustomSources = ["remotive", "greenhouse", "lever"].some((key) => key in nextCore);
  if (hasCustomSources) next.core = nextCore;
  else delete next.core;
  return next;
}
