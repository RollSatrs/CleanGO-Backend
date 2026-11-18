import { describe, expect, it } from "vitest";
import { availabilityExpiresAt, availabilityStatus, locationIsFresh } from "./cleaner-availability.js";

const now = new Date("2026-11-18T12:00:00Z");
const fresh = new Date("2026-11-18T11:50:00Z");
const location = { latitude: 50.4, longitude: 80.2, lastLocationAt: fresh };

describe("cleaner availability rules", () => {
  it("allows exactly 1, 2 or 4 hour sessions", () => {
    expect(availabilityExpiresAt(1, now).toISOString()).toBe("2026-11-18T13:00:00.000Z");
    expect(availabilityExpiresAt(4, now).toISOString()).toBe("2026-11-18T16:00:00.000Z");
    expect(() => availabilityExpiresAt(3 as 1)).toThrow(RangeError);
  });
  it("does not treat saved location as permanent availability", () => {
    expect(availabilityStatus({ optedIn: false, expiresAt: availabilityExpiresAt(2, now), ...location }, now).effectiveAvailable).toBe(false);
    expect(availabilityStatus({ optedIn: true, expiresAt: new Date(now.getTime() - 1), ...location }, now)).toMatchObject({
      effectiveAvailable: false, availabilityExpired: true, timeRemainingSeconds: 0,
    });
  });
  it("shows a countdown and requires fresh GPS for matching", () => {
    expect(availabilityStatus({ optedIn: true, expiresAt: availabilityExpiresAt(1, now), ...location }, now)).toMatchObject({
      effectiveAvailable: true, timeRemainingSeconds: 3600, locationNeedsRefresh: false,
    });
    expect(availabilityStatus({ optedIn: true, expiresAt: availabilityExpiresAt(1, now), ...location, lastLocationAt: new Date(now.getTime() - 31 * 60_000) }, now)).toMatchObject({
      effectiveAvailable: false, locationNeedsRefresh: true,
    });
  });
  it("rejects future, invalid and stale coordinates", () => {
    expect(locationIsFresh(50, 80, new Date(now.getTime() + 1), now)).toBe(false);
    expect(locationIsFresh(95, 80, fresh, now)).toBe(false);
    expect(locationIsFresh(null, 80, fresh, now)).toBe(false);
    expect(locationIsFresh(50, 80, new Date(now.getTime() - 30 * 60_000), now)).toBe(true);
  });
});
