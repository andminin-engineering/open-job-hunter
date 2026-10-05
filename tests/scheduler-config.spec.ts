import { describe, expect, it } from "vitest";
import {
  LEGACY_DEFAULT_GREENHOUSE,
  LEGACY_DEFAULT_LEVER,
  LEGACY_DEFAULT_REMOTIVE_SEARCH,
  stripLegacySchedulerDefaults,
} from "../src/scheduler-config.js";

const legacyCore = {
  remotive: { search: LEGACY_DEFAULT_REMOTIVE_SEARCH, limit: 10 },
  greenhouse: LEGACY_DEFAULT_GREENHOUSE,
  lever: LEGACY_DEFAULT_LEVER,
  continueOnError: true,
};

describe("legacy scheduler configuration", () => {
  it("drops sources copied from the old defaults so the profile drives discovery", () => {
    const migrated = stripLegacySchedulerDefaults({ recipientEmail: "me@example.com", core: legacyCore });
    expect(migrated).toEqual({ recipientEmail: "me@example.com" });
  });

  it("keeps Greenhouse and Lever sources the user customised", () => {
    const greenhouse = [{ board: "acme", company: "Acme", limit: 5 }];
    const lever = [{ company: "globex", limit: 3 }];

    const migrated = stripLegacySchedulerDefaults({ core: { ...legacyCore, greenhouse, lever } });

    expect(migrated.core).toEqual({ greenhouse, lever, continueOnError: true });
  });

  it("keeps one customised source while removing the untouched default", () => {
    const lever = [{ company: "globex", limit: 3 }];
    const migrated = stripLegacySchedulerDefaults({ core: { ...legacyCore, lever } });
    expect(migrated.core).toEqual({ lever, continueOnError: true });
  });

  it("leaves files without the legacy marker untouched", () => {
    const overrides = { core: { remotive: { search: "ux researcher", limit: 5 }, greenhouse: LEGACY_DEFAULT_GREENHOUSE } };
    expect(stripLegacySchedulerDefaults(overrides)).toBe(overrides);
  });
});
