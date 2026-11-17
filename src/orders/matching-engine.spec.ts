import { describe, expect, it } from "vitest";
import { isEligible, rankCandidates, selectOfferBatch, type MatchingCandidate } from "./matching-engine.js";

const candidate = (cleanerId: string, patch: Partial<MatchingCandidate> = {}): MatchingCandidate => ({
  cleanerId, verified: true, available: true, hasActiveOrder: false,
  supportsCleaningType: true, servesArea: true, ...patch,
});

describe("matching eligibility", () => {
  it("rejects unverified, unavailable, busy, out-of-area and wrong-specialty cleaners", () => {
    for (const patch of [
      { verified: false }, { available: false }, { hasActiveOrder: true },
      { servesArea: false }, { supportsCleaningType: false },
    ]) expect(isEligible(candidate("c", patch))).toBe(false);
  });

  it("ranks eligible cleaners by real ETA and does not treat unrated as zero-star", () => {
    const ranked = rankCandidates([
      candidate("slow", { etaMinutes: 12, rating: 5 }),
      candidate("new", { etaMinutes: 5 }),
      candidate("fast", { etaMinutes: 3, rating: 3 }),
      candidate("excluded", { etaMinutes: 1, available: false }),
    ]);
    expect(ranked.map(c => c.cleanerId)).toEqual(["fast", "new", "slow"]);
  });

  it("moves to a fresh group after prior offers expire or are declined", () => {
    const ranked = rankCandidates([
      candidate("a"), candidate("b"), candidate("c"),
      candidate("d"), candidate("e"), candidate("f"),
    ]);
    const first = selectOfferBatch(ranked, new Set<string>(), 3);
    expect(first.map(c => c.cleanerId)).toEqual(["a", "b", "c"]);
    const previouslyOffered = new Set(first.map(c => c.cleanerId));
    const second = selectOfferBatch(ranked, previouslyOffered, 3);
    expect(second.map(c => c.cleanerId)).toEqual(["d", "e", "f"]);
    second.forEach(c => previouslyOffered.add(c.cleanerId));
    expect(selectOfferBatch(ranked, previouslyOffered, 3)).toEqual([]);
  });

  it("makes deterministic batches without reoffering previous cleaners", () => {
    const ranked = rankCandidates([candidate("a"), candidate("b"), candidate("c")]);
    expect(selectOfferBatch(ranked, new Set(["a"]), 2).map(c => c.cleanerId)).toEqual(["b", "c"]);
    expect(() => selectOfferBatch(ranked, new Set(), 0)).toThrow(RangeError);
  });
});
