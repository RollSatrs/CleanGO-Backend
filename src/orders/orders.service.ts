
import { Injectable, ConflictException, BadRequestException, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { eq, desc, and, isNull, gt, lte, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { orders, orderOffers, orderEvents, cleanerProfiles, users } from "../db/schema.js";
import { rankCandidates, selectOfferBatch, type MatchingCandidate } from "./matching-engine.js";
import { locationIsFresh, availabilityStatus, availabilityExpiresAt, type AvailabilityHours } from "./cleaner-availability.js";

import { PricingService } from "../pricing/pricing.service.js";
import { CreateOrderDto } from "./dto/create-order.dto.js";

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private matchingTimer?: ReturnType<typeof setInterval>;
  private matchingRunning = false;
  // Maximum total search window, independent of individual five-minute offers.
  private readonly matchingMaxAgeMs = 15 * 60_000;

  onModuleInit() {
    // Worker runs only in the backend process. PostgreSQL row locks prevent duplicate waves.
    this.matchingTimer = setInterval(() => void this.processMatchingQueue(), 30_000);
    this.matchingTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.matchingTimer) clearInterval(this.matchingTimer);
  }

  private async processMatchingQueue() {
    if (this.matchingRunning) return;
    this.matchingRunning = true;
    try {
      const pending = await db.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.status, "pending"), isNull(orders.cleanerId)))
        .orderBy(orders.createdAt).limit(50);
      for (const order of pending) {
        try { await this.dispatchWave(order.id); }
        catch (error) { this.logger.error(`Matching retry failed for ${order.id}`, error instanceof Error ? error.stack : String(error)); }
      }
    } catch (error) {
      this.logger.error("Matching queue failed", error instanceof Error ? error.stack : String(error));
    } finally { this.matchingRunning = false; }
  }

  private readonly logger = new Logger(OrdersService.name);
  constructor(
    private readonly pricingService: PricingService,
  ) {}

  async getCleanerProfile(cleanerId: string) {
    const [profile] = await db.select().from(cleanerProfiles)
      .where(eq(cleanerProfiles.userId, cleanerId)).limit(1);
    if (!profile) return {
      isAvailable: false, effectiveAvailable: false, locationNeedsRefresh: false, serviceRadiusKm: 5,
      serviceTypes: ["regular", "general", "renovation"],
      hasLocation: false, lastLocationAt: null, availableUntil: null, timeRemainingSeconds: 0, availabilityExpired: false,
    };
    const hasLocation = profile.latitude != null && profile.longitude != null;
    const availability = availabilityStatus({ optedIn: profile.isAvailable, expiresAt: profile.availableUntil, latitude: profile.latitude, longitude: profile.longitude, lastLocationAt: profile.lastLocationAt });
    return {
      isAvailable: profile.isAvailable,
      ...availability,
      availableUntil: profile.availableUntil,
      serviceRadiusKm: profile.serviceRadiusKm ?? 5,
      serviceTypes: profile.serviceTypes ?? [],
      hasLocation,
      lastLocationAt: profile.lastLocationAt,
    };
  }

  async updateCleanerProfile(cleanerId: string, input: {
    isAvailable: boolean;
    serviceRadiusKm: number;
    serviceTypes: string[];
    latitude?: number;
    longitude?: number;
    availabilityHours?: AvailabilityHours;
  }) {
    if ((input.latitude == null) !== (input.longitude == null)) {
      throw new BadRequestException("Координаты нужно передавать вместе");
    }
    const [existing] = await db.select({
      userId: cleanerProfiles.userId,
      latitude: cleanerProfiles.latitude,
      longitude: cleanerProfiles.longitude,
      lastLocationAt: cleanerProfiles.lastLocationAt,
      isAvailable: cleanerProfiles.isAvailable,
      availableUntil: cleanerProfiles.availableUntil,
    }).from(cleanerProfiles).where(eq(cleanerProfiles.userId, cleanerId)).limit(1);
    const now = Date.now();
    const savedLocationFresh = locationIsFresh(existing?.latitude, existing?.longitude, existing?.lastLocationAt, new Date(now));
    if (input.isAvailable && input.latitude == null && !savedLocationFresh) {
      throw new BadRequestException("Для выхода на линию обновите геопозицию. Услуги и радиус можно сохранять отдельно.");
    }
    const sessionHours = input.availabilityHours;
    const availableUntil = !input.isAvailable ? null : sessionHours != null
      ? availabilityExpiresAt(sessionHours)
      : existing?.isAvailable && existing.availableUntil && existing.availableUntil.getTime() > now
        ? existing.availableUntil : availabilityExpiresAt(1);
    const values = {
      isAvailable: input.isAvailable,
      availableUntil,
      serviceRadiusKm: input.serviceRadiusKm,
      serviceTypes: input.serviceTypes,
      ...(input.latitude == null ? {} : {
        latitude: String(input.latitude),
        longitude: String(input.longitude),
        lastLocationAt: new Date(),
      }),
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(cleanerProfiles).set(values)
        .where(eq(cleanerProfiles.userId, cleanerId));
    } else {
      await db.insert(cleanerProfiles).values({ userId: cleanerId, ...values })
        .onConflictDoUpdate({ target: cleanerProfiles.userId, set: values });
    }
    return this.getCleanerProfile(cleanerId);
  }

  async create(
    userId: string,
    orderData: CreateOrderDto,
  ) {
    if ((orderData.latitude == null) !== (orderData.longitude == null)) {
      throw new BadRequestException("Широту и долготу нужно указать вместе");
    }

    const quote = this.pricingService.calculate(
      orderData.cleaningType,
      orderData.area,
    );

    const [order] = await db
      .insert(orders)
      .values({
        userId,
        address: orderData.address,
        area: orderData.area,
        cleaningType: orderData.cleaningType,
        price: quote.totalPrice,
        latitude: orderData.latitude == null ? null : String(orderData.latitude),
        longitude: orderData.longitude == null ? null : String(orderData.longitude),
        status: "pending",
      })
      .returning();

    // Matching is best-effort: a temporary matching failure must not lose a saved order.
    try {
      await this.dispatchWave(order.id);
    } catch (error) {
      this.logger.error(`Matching failed for order ${order.id}`, error instanceof Error ? error.stack : String(error));
    }
    return order;
  }

  /**
   * Only a currently offered, unexpired private proposal may accept.
   * The conditional order UPDATE serializes competing acceptances in PostgreSQL.
   * All offer changes and audit records commit in the same transaction.
   */
  async accept(orderId: string, cleanerId: string) {
    return db.transaction(async (tx) => {
      const now = new Date();
      const [accepted] = await tx.update(orders)
        .set({ cleanerId, acceptedAt: now, status: "accepted" })
        .where(and(
          eq(orders.id, orderId),
          eq(orders.status, "pending"),
          isNull(orders.cleanerId),
          sql`EXISTS (
            SELECT 1 FROM order_offers AS offer
            WHERE offer.order_id = ${orders.id}
              AND offer.cleaner_id = ${cleanerId}
              AND offer.status = 'offered'
              AND offer.expires_at > ${now}
          )`,
        ))
        .returning();

      if (!accepted) {
        throw new ConflictException("Предложение истекло, отозвано или заказ недоступен");
      }

      await tx.update(orderOffers)
        .set({ status: "accepted", respondedAt: now })
        .where(and(
          eq(orderOffers.orderId, orderId),
          eq(orderOffers.cleanerId, cleanerId),
          eq(orderOffers.status, "offered"),
          gt(orderOffers.expiresAt, now),
        ));

      await tx.update(orderOffers)
        .set({ status: "revoked", respondedAt: now })
        .where(and(
          eq(orderOffers.orderId, orderId),
          eq(orderOffers.status, "offered"),
        ));

      await tx.insert(orderEvents).values({
        orderId,
        actorId: cleanerId,
        eventType: "order_accepted",
      });

      return accepted;
    });
  }


  /**
   * Initial matching wave only. Missing/stale coordinates are NOT treated as
   * a service-area match. No address or apartment data is sent to candidates.
   * Later waves require a separate worker with locking and retry semantics.
   */
  async dispatchWave(orderId: string) {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order || order.status !== "pending" || order.latitude == null || order.longitude == null) {
      return { offered: 0, reason: "not_eligible_for_geographic_matching" };
    }

    const latitude = Number(order.latitude);
    const longitude = Number(order.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return { offered: 0, reason: "invalid_coordinates" };
    }

    const profiles = await db.select({
      cleanerId: cleanerProfiles.userId,
      available: cleanerProfiles.isAvailable,
      availableUntil: cleanerProfiles.availableUntil,
      serviceTypes: cleanerProfiles.serviceTypes,
      radius: cleanerProfiles.serviceRadiusKm,
      latitude: cleanerProfiles.latitude,
      longitude: cleanerProfiles.longitude,
      lastLocationAt: cleanerProfiles.lastLocationAt,
      role: users.role,
      phoneVerifiedAt: users.phoneVerifiedAt,
    }).from(cleanerProfiles).innerJoin(users, eq(cleanerProfiles.userId, users.id));

    const busy = await db.select({ cleanerId: orders.cleanerId })
      .from(orders)
      .where(and(sql`${orders.status} IN ('accepted', 'in_progress')`, sql`${orders.cleanerId} IS NOT NULL`));
    const busyIds = new Set(busy.map(row => row.cleanerId).filter((id): id is string => id !== null));
    const now = new Date();

    const candidates: MatchingCandidate[] = profiles.map(profile => {
      const lat = profile.latitude == null ? null : Number(profile.latitude);
      const lon = profile.longitude == null ? null : Number(profile.longitude);
      const locationFresh = locationIsFresh(profile.latitude, profile.longitude, profile.lastLocationAt, now);
      let servesArea = false;
      if (lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon) &&
          Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
          profile.radius != null && profile.radius > 0 && locationFresh) {
        const rad = Math.PI / 180;
        const dLat = (lat - latitude) * rad;
        const dLon = (lon - longitude) * rad;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(latitude * rad) * Math.cos(lat * rad) * Math.sin(dLon / 2) ** 2;
        const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
        servesArea = km <= profile.radius;
      }
      return {
        cleanerId: profile.cleanerId,
        verified: profile.role === "cleaner" && profile.phoneVerifiedAt != null,
        available: availabilityStatus({ optedIn: profile.available, expiresAt: profile.availableUntil, latitude: profile.latitude, longitude: profile.longitude, lastLocationAt: profile.lastLocationAt }, now).effectiveAvailable,
        hasActiveOrder: busyIds.has(profile.cleanerId),
        supportsCleaningType: profile.serviceTypes?.includes(order.cleaningType) === true,
        servesArea,
      };
    });

    const ranked = rankCandidates(candidates);

    return db.transaction(async tx => {
      // Serialize any competing dispatch attempts for the same order.
      const locked = await tx.execute(sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
      if (!locked.rows.length) return { offered: 0, reason: "order_missing" };
      const [current] = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (!current || current.status !== "pending" || current.cleanerId) {
        return { offered: 0, reason: "order_no_longer_pending" };
      }
      const now = new Date();
      // End the search only after the total window has elapsed and no offer is still active.
      // This also safely resolves historical pending orders without touching accepted jobs.
      const existing = await tx.select({
        cleanerId: orderOffers.cleanerId,
        status: orderOffers.status,
        expiresAt: orderOffers.expiresAt,
      }).from(orderOffers).where(eq(orderOffers.orderId, orderId));

      const searchStarted = current.matchingStartedAt ?? current.createdAt;
      const searchExpired = now.getTime() - searchStarted.getTime() >= this.matchingMaxAgeMs;
      const hasActiveOffer = existing.some(offer => offer.status === "offered" && offer.expiresAt > now);
      if (searchExpired && !hasActiveOffer) {
        await tx.update(orderOffers).set({ status: "expired", respondedAt: now })
          .where(and(eq(orderOffers.orderId, orderId), eq(orderOffers.status, "offered")));
        await tx.update(orders).set({ status: "unassigned" })
          .where(and(eq(orders.id, orderId), eq(orders.status, "pending"), isNull(orders.cleanerId)));
        await tx.insert(orderEvents).values({ orderId, eventType: "matching_timeout" });
        return { offered: 0, reason: "matching_timeout" };
      }
      // Wait until all active proposals are answered or expire.
      if (existing.some(offer => offer.status === "offered" && offer.expiresAt > now)) {
        return { offered: 0, reason: "active_offers" };
      }
      await tx.update(orderOffers).set({ status: "expired", respondedAt: now })
        .where(and(eq(orderOffers.orderId, orderId),
          eq(orderOffers.status, "offered"), lte(orderOffers.expiresAt, now)));

      // Never re-offer to a cleaner who declined or previously timed out.
      const previouslyOffered = new Set(existing.map(offer => offer.cleanerId));
      const selected = selectOfferBatch(ranked, previouslyOffered, 3);
      if (!selected.length) return { offered: 0, reason: "no_more_eligible_cleaners" };

      const round = current.matchingRound + 1;
      // Engineering TTL until product parameters are approved.
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
      await tx.insert(orderOffers).values(selected.map(candidate => ({
        orderId, cleanerId: candidate.cleanerId, batchNumber: round,
        status: "offered", expiresAt,
      })));
      await tx.update(orders).set({
        matchingRound: round,
        matchingStartedAt: current.matchingStartedAt ?? now,
      }).where(eq(orders.id, orderId));
      await tx.insert(orderEvents).values({
        orderId, eventType: "matching_wave_created",
      });
      return { offered: selected.length, round, expiresAt };
    });
  }

  async startCleaning(orderId: string, cleanerId: string) {
    return db.transaction(async tx => {
      const [updated] = await tx.update(orders)
        .set({ status: "in_progress" })
        .where(and(eq(orders.id, orderId), eq(orders.cleanerId, cleanerId), eq(orders.status, "accepted")))
        .returning();
      if (!updated) throw new ConflictException("Заказ не назначен вам или уже начат");
      await tx.insert(orderEvents).values({ orderId, actorId: cleanerId, eventType: "cleaning_started" });
      return updated;
    });
  }

  async completeCleaning(orderId: string, cleanerId: string) {
    return db.transaction(async tx => {
      const [updated] = await tx.update(orders)
        .set({ status: "completed" })
        .where(and(eq(orders.id, orderId), eq(orders.cleanerId, cleanerId), eq(orders.status, "in_progress")))
        .returning();
      if (!updated) throw new ConflictException("Завершить можно только свою выполняемую уборку");
      await tx.insert(orderEvents).values({ orderId, actorId: cleanerId, eventType: "cleaning_completed" });
      return updated;
    });
  }

  async findCleanerJobs(cleanerId: string) {
    return db.select().from(orders)
      .where(and(eq(orders.cleanerId, cleanerId), sql`${orders.status} IN ('accepted', 'in_progress')`))
      .orderBy(desc(orders.createdAt));
  }

  /**
   * Private active proposals for one authenticated cleaner.
   * Deliberately select only non-sensitive order fields: never return
   * full address, exact coordinates, apartment, or client identity.
   */
  async findActiveOffers(cleanerId: string) {
    const now = new Date();
    return db.select({
      offerId: orderOffers.id,
      orderId: orderOffers.orderId,
      expiresAt: orderOffers.expiresAt,
      cleaningType: orders.cleaningType,
      area: orders.area,
      price: orders.price,
      approximateArea: orders.areaHint,
      createdAt: orders.createdAt,
    })
      .from(orderOffers)
      .innerJoin(orders, eq(orderOffers.orderId, orders.id))
      .where(and(
        eq(orderOffers.cleanerId, cleanerId),
        eq(orderOffers.status, "offered"),
        gt(orderOffers.expiresAt, now),
        eq(orders.status, "pending"),
        isNull(orders.cleanerId),
      ))
      .orderBy(desc(orders.createdAt));
  }

  /** A cleaner may decline only their own active private offer. */
  async decline(orderId: string, cleanerId: string) {
    return db.transaction(async (tx) => {
      const now = new Date();
      const [declined] = await tx.update(orderOffers)
        .set({ status: "declined", respondedAt: now })
        .where(and(
          eq(orderOffers.orderId, orderId),
          eq(orderOffers.cleanerId, cleanerId),
          eq(orderOffers.status, "offered"),
          gt(orderOffers.expiresAt, now),
          sql`EXISTS (
            SELECT 1 FROM orders AS o
            WHERE o.id = ${orderOffers.orderId}
              AND o.status = 'pending'
              AND o.cleaner_id IS NULL
          )`,
        ))
        .returning({ id: orderOffers.id });

      if (!declined) {
        throw new ConflictException("Активное предложение не найдено");
      }
      await tx.insert(orderEvents).values({
        orderId,
        actorId: cleanerId,
        eventType: "offer_declined",
      });
      return { declined: true };
    });
  }

  async findByUserId(userId: string) {
    return db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt));
  }
}
