/** Approved product decision: rank eligible nearby cleaners, offer each batch concurrently.
 * First eligible atomic acceptance wins; others expire. Not implemented yet.
 */
export const ORDER_ASSIGNMENT_MODEL = "ranked_batch_offers" as const;

/** Initial engineering defaults, NOT approved operational values. */
export const MATCHING_PROPOSAL = {
  initialBatchSize: 3,
  offerTimeoutSeconds: 30,
  candidateRadiusKm: 5,
  maxCandidateRadiusKm: 15,
} as const;

export const ORDER_STATUSES = [
  "pending",
  "accepted",
  "in_progress",
  "pending_confirmation",
  "completed",
  "disputed",
  "unassigned",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Client creates pending; only an eligible cleaner may accept.
 * Transitions must be enforced by the server, never trusted from a client payload.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["accepted", "cancelled"],
  accepted: ["in_progress", "cancelled"],
  in_progress: ["pending_confirmation", "cancelled"],
  pending_confirmation: ["completed", "disputed"],
  completed: [],
  disputed: [],
  unassigned: [],
  cancelled: [],
};

/** Public job feeds must not include address, apartment, contact or exact coordinates.
 * Exact location is visible only to the client and the assigned cleaner.
 */
export const ORDER_ADDRESS_VISIBILITY = {
  client: "own_order",
  cleaner: "assigned_order_only",
  publicFeed: "approximate_area_only",
} as const;
