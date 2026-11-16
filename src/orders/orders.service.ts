
import { Injectable, ConflictException, BadRequestException, Logger } from "@nestjs/common";
import { eq, desc, and, isNull, gt, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { orders, orderOffers, orderEvents, cleanerProfiles, users } from "../db/schema.js";
import { rankCandidates, selectOfferBatch, type MatchingCandidate } from "./matching-engine.js";

import { PricingService } from "../pricing/pricing.service.js";
import { CreateOrderDto } from "./dto/create-order.dto.js";

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  constructor(
    private readonly pricingService: PricingService,
  ) {}

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
      await this.dispatchFirstWave(order.id);
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
  async dispatchFirstWave(orderId: string) {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order || order.status !== "pending" || order.matchingRound !== 0 ||
        order.latitude == null || order.longitude == null) {
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
      .where(and(eq(orders.status, "accepted"), sql`${orders.cleanerId} IS NOT NULL`));
    const busyIds = new Set(busy.map(row => row.cleanerId).filter((id): id is string => id !== null));
    const now = new Date();
    const maxLocationAgeMs = 30 * 60 * 1000;

    const candidates: MatchingCandidate[] = profiles.map(profile => {
      const lat = profile.latitude == null ? null : Number(profile.latitude);
      const lon = profile.longitude == null ? null : Number(profile.longitude);
      const locationFresh = profile.lastLocationAt != null &&
        profile.lastLocationAt.getTime() <= now.getTime() &&
        now.getTime() - profile.lastLocationAt.getTime() <= maxLocationAgeMs;
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
        available: profile.available,
        hasActiveOrder: busyIds.has(profile.cleanerId),
        supportsCleaningType: profile.serviceTypes?.includes(order.cleaningType) === true,
        servesArea,
      };
    });

    const selected = selectOfferBatch(rankCandidates(candidates), new Set<string>(), 3);
    if (!selected.length) return { offered: 0, reason: "no_eligible_cleaners" };

    return db.transaction(async tx => {
      // Serialize any competing dispatch attempts for the same order.
      const locked = await tx.execute(sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
      if (!locked.rows.length) return { offered: 0, reason: "order_missing" };
      const [current] = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (!current || current.status !== "pending" || current.matchingRound !== 0) {
        return { offered: 0, reason: "already_dispatched" };
      }
      const existing = await tx.select({ id: orderOffers.id })
        .from(orderOffers).where(eq(orderOffers.orderId, orderId)).limit(1);
      if (existing.length) return { offered: 0, reason: "already_offered" };

      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await tx.insert(orderOffers).values(selected.map(candidate => ({
        orderId, cleanerId: candidate.cleanerId, batchNumber: 1,
        status: "offered", expiresAt,
      })));
      await tx.update(orders).set({ matchingRound: 1, matchingStartedAt: now })
        .where(eq(orders.id, orderId));
      await tx.insert(orderEvents).values({
        orderId, eventType: "matching_first_wave_created",
      });
      return { offered: selected.length, expiresAt };
    });
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
