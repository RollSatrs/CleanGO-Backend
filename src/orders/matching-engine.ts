/**
 * Pure, deterministic first stage of CleanGo matching.
 * No database writes, no address exposure, no invented distance/ETA.
 * Call only with verified profiles and a server-computed service-area match.
 */
export interface MatchingCandidate {
  cleanerId: string;
  verified: boolean;
  available: boolean;
  hasActiveOrder: boolean;
  supportsCleaningType: boolean;
  servesArea: boolean;
  /** Server-calculated route ETA, only when a real routing provider is available. */
  etaMinutes?: number | null;
  /** Published-review rating; missing rating is NOT zero. */
  rating?: number | null;
  reviewCount?: number;
  reliabilityScore?: number | null;
}

export function isEligible(candidate: MatchingCandidate): boolean {
  return candidate.verified &&
    candidate.available &&
    !candidate.hasActiveOrder &&
    candidate.supportsCleaningType &&
    candidate.servesArea;
}

/**
 * Eligibility is mandatory. Known ETA sorts first; among unknown ETA candidates,
 * verified reliability and rating break ties. New cleaners retain a chance
 * instead of receiving a fabricated zero-star rating.
 * cleanerId ensures stable ordering across repeated requests.
 */
export function rankCandidates(candidates: readonly MatchingCandidate[]): MatchingCandidate[] {
  return candidates.filter(isEligible).sort((a, b) => {
    const aEta = a.etaMinutes != null && Number.isFinite(a.etaMinutes) && a.etaMinutes >= 0 ? a.etaMinutes : null;
    const bEta = b.etaMinutes != null && Number.isFinite(b.etaMinutes) && b.etaMinutes >= 0 ? b.etaMinutes : null;
    if (aEta !== null && bEta !== null && aEta !== bEta) return aEta - bEta;
    if ((aEta === null) !== (bEta === null)) return aEta === null ? 1 : -1;
    const aReliability = a.reliabilityScore ?? 0;
    const bReliability = b.reliabilityScore ?? 0;
    if (aReliability !== bReliability) return bReliability - aReliability;
    const aRating = a.rating ?? null;
    const bRating = b.rating ?? null;
    if (aRating !== null && bRating !== null && aRating !== bRating) return bRating - aRating;
    return a.cleanerId.localeCompare(b.cleanerId);
  });
}

export function selectOfferBatch(
  ranked: readonly MatchingCandidate[],
  previouslyOfferedCleanerIds: ReadonlySet<string>,
  batchSize: number,
): MatchingCandidate[] {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new RangeError("batchSize must be a positive integer");
  }
  return ranked
    .filter(candidate => isEligible(candidate) && !previouslyOfferedCleanerIds.has(candidate.cleanerId))
    .slice(0, batchSize);
}
