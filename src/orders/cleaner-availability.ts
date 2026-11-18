/** Availability is a time-limited opt-in; a saved location alone never means online. */
export const LOCATION_MAX_AGE_MS = 30 * 60_000;
export const AVAILABILITY_OPTIONS_HOURS = [1, 2, 4] as const;
export type AvailabilityHours = typeof AVAILABILITY_OPTIONS_HOURS[number];

export function locationIsFresh(
  latitude: unknown,
  longitude: unknown,
  updatedAt: Date | null | undefined,
  now = new Date(),
): boolean {
  const lat = Number(latitude);
  const lon = Number(longitude);
  return latitude != null && longitude != null &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
    updatedAt instanceof Date && Number.isFinite(updatedAt.getTime()) &&
    updatedAt.getTime() <= now.getTime() &&
    now.getTime() - updatedAt.getTime() <= LOCATION_MAX_AGE_MS;
}

export function availabilityExpiresAt(
  hours: AvailabilityHours,
  now = new Date(),
): Date {
  if (!AVAILABILITY_OPTIONS_HOURS.includes(hours)) {
    throw new RangeError("Availability must be 1, 2 or 4 hours");
  }
  return new Date(now.getTime() + hours * 3_600_000);
}

export function availabilityStatus(input: {
  optedIn: boolean;
  expiresAt: Date | null | undefined;
  latitude: unknown;
  longitude: unknown;
  lastLocationAt: Date | null | undefined;
}, now = new Date()) {
  const timeRemainingMs = input.expiresAt instanceof Date && Number.isFinite(input.expiresAt.getTime())
    ? Math.max(0, input.expiresAt.getTime() - now.getTime()) : 0;
  const locationFresh = locationIsFresh(input.latitude, input.longitude, input.lastLocationAt, now);
  return {
    effectiveAvailable: input.optedIn && timeRemainingMs > 0 && locationFresh,
    locationNeedsRefresh: input.optedIn && timeRemainingMs > 0 && !locationFresh,
    availabilityExpired: input.optedIn && timeRemainingMs === 0,
    timeRemainingSeconds: Math.ceil(timeRemainingMs / 1000),
  };
}
