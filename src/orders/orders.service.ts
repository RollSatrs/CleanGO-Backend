
import { Injectable, ConflictException, BadRequestException, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { eq, desc, and, isNull, gt, lte, sql, inArray, count } from "drizzle-orm";

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
    this.matchingTimer = setInterval(() => void this.processMatchingQueue(), 5_000);
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
      await this.processCompletionQueue();
      for (const order of pending) {
        try { await this.dispatchWave(order.id); }
        catch (error) { this.logger.error(`Matching retry failed for ${order.id}`, error instanceof Error ? error.stack : String(error)); }
      }
    } catch (error) {
      this.logger.error("Matching queue failed", error instanceof Error ? error.stack : String(error));
    } finally { this.matchingRunning = false; }
  }

  private readonly logger = new Logger(OrdersService.name);
  /** Best-effort Telegram notifications. No private address in offer previews. */
  private async notifyTelegram(userId: string, message: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) { this.logger.warn("Telegram notifications disabled: TELEGRAM_BOT_TOKEN missing"); return; }
    try {
      const [recipient] = await db.select({ telegramId: users.telegramId })
        .from(users).where(eq(users.id, userId)).limit(1);
      if (!recipient?.telegramId) { this.logger.warn("Telegram notification skipped: recipient has no Telegram ID"); return; }
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: recipient.telegramId.toString(),
          text: message,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{
              text: "📱 Открыть CleanGo",
              web_app: { url: "https://clean-go-frontend.vercel.app" },
            }]],
          },
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { description?: string } | null;
        this.logger.warn(`Telegram notification failed (HTTP ${response.status}): ${result?.description ?? "unknown error"}`);
      }
    } catch (error) {
      this.logger.warn("Telegram notification unavailable: " + String(error));
    }
  }

  private readonly cleaningLabels: Record<string, string> = {
    regular: "Поддерживающая",
    general: "Генеральная",
    renovation: "После ремонта",
  };

  private formatOrderNotice(title: string, order: { id: string; cleaningType: string; area: number; price: number | null }, detail: string) {
    const kind = this.cleaningLabels[order.cleaningType] ?? "Уборка";
    const price = order.price == null ? "Уточняется" : `${order.price.toLocaleString("ru-RU")} ₸`;
    return [
      title,
      "",
      `🧹 <b>Услуга:</b> ${kind}`,
      `📐 <b>Площадь:</b> ${order.area} м²`,
      `💳 <b>Стоимость:</b> ${price}`,
      `🆔 <b>Заказ:</b> ${order.id.slice(0, 8)}`,
      "",
      detail,
      "",
      "Нажмите кнопку ниже, чтобы открыть приложение.",
    ].join("\n");
  }


  constructor(
    private readonly pricingService: PricingService,
  ) {}

  /** Recent activity for the authenticated user; never expose another user's orders. */
  async getNotifications(userId: string, role: string) {
    if (role !== "client" && role !== "cleaner") return [];
    if (role === "client") {
      const rows = await db.select({
        id: orderEvents.id, orderId: orderEvents.orderId,
        type: orderEvents.eventType, createdAt: orderEvents.createdAt,
      }).from(orderEvents).innerJoin(orders, eq(orderEvents.orderId, orders.id))
        .where(eq(orders.userId, userId)).orderBy(desc(orderEvents.createdAt)).limit(80);
      return rows.filter(row => [
        "order_accepted", "cleaner_en_route", "cleaner_arrived",
        "cleaning_started", "cleaning_completed", "completion_reminder_sent", "completion_confirmed", "completion_issue_reported", "matching_timeout", "order_cancelled",
      ].includes(row.type));
    }
    const events = await db.select({
      id: orderEvents.id, orderId: orderEvents.orderId,
      type: orderEvents.eventType, createdAt: orderEvents.createdAt,
    }).from(orderEvents).innerJoin(orders, eq(orderEvents.orderId, orders.id))
      .where(eq(orders.cleanerId, userId)).orderBy(desc(orderEvents.createdAt)).limit(60);
    const offers = await db.select({
      id: orderOffers.id, orderId: orderOffers.orderId,
      createdAt: orderOffers.createdAt,
    }).from(orderOffers).where(eq(orderOffers.cleanerId, userId))
      .orderBy(desc(orderOffers.createdAt)).limit(40);
    return [...events.filter(row => [
      "order_accepted", "cleaning_completed", "completion_confirmed", "order_cancelled",
    ].includes(row.type)).map(row => ({ ...row, type: row.type === "order_accepted" ? "cleaner_order_accepted" : row.type === "cleaning_completed" ? "cleaner_job_completed" : "cleaner_order_cancelled" })), ...offers.map(offer => ({ ...offer, type: "new_offer" }))]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 80);
  }

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
    // A newly refreshed/available cleaner can be considered promptly for pending orders.
    // The queue retains its locking and eligibility checks.
    if (input.isAvailable) void this.processMatchingQueue();
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

      if(accepted.userId) void this.notifyTelegram(accepted.userId,this.formatOrderNotice("✅ <b>Клинер найден!</b>",accepted,"Исполнитель принял заказ. Следите за его статусом в приложении."));
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
      .where(and(sql`${orders.status} IN ('accepted', 'en_route', 'arrived', 'in_progress')`, sql`${orders.cleanerId} IS NOT NULL`));
    const busyIds = new Set(busy.map(row => row.cleanerId).filter((id): id is string => id !== null));
    const now = new Date();
    // Reputation uses only confirmed, completed jobs. Bayesian smoothing prevents
    // a single five-star review from outranking experienced cleaners by default.
    const completedRatings = await db.select({cleanerId:orders.cleanerId,rating:orders.rating})
      .from(orders).where(and(eq(orders.status,"completed"),sql`${orders.rating} IS NOT NULL`));
    const reputation = new Map<string,{count:number;sum:number}>();
    for(const item of completedRatings) {
      if(!item.cleanerId || item.rating==null)continue;
      const stat=reputation.get(item.cleanerId)??{count:0,sum:0};
      stat.count++;stat.sum+=item.rating;reputation.set(item.cleanerId,stat);
    }

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
        // Prior 4.2 with weight 5 keeps new cleaners eligible and reduces one-review bias.
        rating: (()=>{const stat=reputation.get(profile.cleanerId);return stat?(stat.sum+4.2*5)/(stat.count+5):4.2;})(),
        reviewCount:reputation.get(profile.cleanerId)?.count??0,
      };
    });

    const ranked = rankCandidates(candidates);

    const result=await db.transaction(async tx => {
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
      // Short pilot offer window: next matching wave can proceed after 90 seconds.
      const expiresAt = new Date(now.getTime() + 90 * 1000);
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
      return { offered: selected.length, round, expiresAt, cleanerIds:selected.map(candidate=>candidate.cleanerId) };
    });
    if("cleanerIds" in result && result.cleanerIds) for(const cleanerId of result.cleanerIds) {
      void this.notifyTelegram(cleanerId,this.formatOrderNotice("🔔 <b>Новый заказ для вас</b>",order,"⏳ Предложение действует 90 секунд. Заказ одновременно доступен нескольким клинерам — первым принимает тот, кто успеет."));
    }
    return result;
  }

  /** Per-order, explicit opt-in; no tracking when not en route. */
  async updateTripLocation(orderId: string, cleanerId: string, latitude: number | null, longitude: number | null) {
    const [order] = await db.select({status:orders.status}).from(orders)
      .where(and(eq(orders.id,orderId),eq(orders.cleanerId,cleanerId))).limit(1);
    if(!order || order.status!=="en_route") throw new ConflictException("Геопозиция доступна только во время поездки");
    if(latitude===null && longitude===null) {
      await db.insert(orderEvents).values({orderId,actorId:cleanerId,eventType:"trip_location_off"});
      return {sharing:false};
    }
    if(latitude===null || longitude===null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180) throw new BadRequestException("Некорректные координаты");
    await db.transaction(async tx=>{
      await tx.update(cleanerProfiles).set({latitude:String(latitude),longitude:String(longitude),lastLocationAt:new Date()}).where(eq(cleanerProfiles.userId,cleanerId));
      await tx.insert(orderEvents).values({orderId,actorId:cleanerId,eventType:"trip_location_on"});
    });
    return {sharing:true};
  }

  async markEnRoute(orderId: string, cleanerId: string, input: { travelMode?: string; latitude?: number; longitude?: number } = {}) {
    const mode = input.travelMode ?? "car";
    if (!["car", "walking", "transit"].includes(mode)) throw new BadRequestException("Некорректный способ передвижения");
    const [order] = await db.select({latitude:orders.latitude,longitude:orders.longitude,status:orders.status})
      .from(orders).where(and(eq(orders.id,orderId),eq(orders.cleanerId,cleanerId))).limit(1);
    if (!order || order.status !== "accepted") throw new ConflictException("Заказ уже изменён или не назначен вам");
    let startLat = input.latitude, startLon = input.longitude;
    if (startLat == null || startLon == null) {
      const [profile] = await db.select({latitude:cleanerProfiles.latitude,longitude:cleanerProfiles.longitude,lastLocationAt:cleanerProfiles.lastLocationAt})
        .from(cleanerProfiles).where(eq(cleanerProfiles.userId,cleanerId)).limit(1);
      if (profile?.lastLocationAt && Date.now()-profile.lastLocationAt.getTime()<15*60_000 && profile.latitude!=null && profile.longitude!=null) {
        startLat=Number(profile.latitude);startLon=Number(profile.longitude);
      }
    }
    const valid=(lat:number|undefined,lon:number|undefined)=>lat!=null && lon!=null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180;
    let etaMinutes:number|null=null;
    if(valid(startLat,startLon) && order.latitude!=null && order.longitude!=null) {
      const endLat=Number(order.latitude), endLon=Number(order.longitude);
      if(valid(endLat,endLon)) {
        // Fallback distance is an estimate, not a real transit timetable or pedestrian route.
        const rad=Math.PI/180;
        const dLat=(endLat-startLat!)*rad, dLon=(endLon-startLon!)*rad;
        const h=Math.sin(dLat/2)**2+Math.cos(startLat!*rad)*Math.cos(endLat*rad)*Math.sin(dLon/2)**2;
        const directKm=6371*2*Math.asin(Math.min(1,Math.sqrt(h)));
        let roadKm:number|null=null, driveMinutes:number|null=null;
        try {
          const controller=new AbortController();
          const timeout=setTimeout(()=>controller.abort(),6000);
          try {
            const url=`https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=false`;
            const response=await fetch(url,{signal:controller.signal});
            if(response.ok) {
              const data=await response.json() as {code?:string;routes?:Array<{distance:number;duration:number}>};
              const route=data.routes?.[0];
              if(data.code==="Ok" && route && Number.isFinite(route.distance) && route.distance>=0 && Number.isFinite(route.duration) && route.duration>=0) {
                roadKm=route.distance/1000;
                driveMinutes=route.duration/60;
              }
            }
          } finally {clearTimeout(timeout);}
        } catch { /* Public routing service may be temporarily unavailable. */ }
        // Straight-line distance is inflated only when the road route is unavailable.
        const estimatedKm=roadKm??directKm*1.4;
        if(estimatedKm<=100 && Number.isFinite(estimatedKm)) {
          if(mode==="car")etaMinutes=Math.max(1,Math.ceil(driveMinutes??estimatedKm/25*60));
          if(mode==="walking")etaMinutes=Math.max(1,Math.ceil(estimatedKm/4.5*60));
          if(mode==="transit")etaMinutes=Math.max(1,Math.ceil(estimatedKm/18*60+10));
        }
      }
    }
    return db.transaction(async tx=>{
      const [updated]=await tx.update(orders).set({
        status:"en_route",travelMode:mode,etaMinutes,etaCalculatedAt:etaMinutes==null?null:new Date(),
      }).where(and(eq(orders.id,orderId),eq(orders.cleanerId,cleanerId),eq(orders.status,"accepted"))).returning();
      if(!updated)throw new ConflictException("Заказ уже изменён");
      await tx.insert(orderEvents).values({orderId,actorId:cleanerId,eventType:"cleaner_en_route"});
      if(updated.userId)void this.notifyTelegram(updated.userId,this.formatOrderNotice("🚗 <b>Клинер выехал</b>",updated,"Клинер направляется к вам. Примерное время смотрите в Mini App."));
      return updated;
    });
  }

  async markArrived(orderId: string, cleanerId: string) {
    return this.transitionAssigned(orderId, cleanerId, "en_route", "arrived", "cleaner_arrived");
  }

  private async transitionAssigned(orderId: string, cleanerId: string, from: string, to: string, eventType: string) {
    return db.transaction(async tx => {
      const [updated] = await tx.update(orders).set({status:to})
        .where(and(eq(orders.id,orderId),eq(orders.cleanerId,cleanerId),eq(orders.status,from))).returning();
      if(!updated) throw new ConflictException("Заказ не в нужном статусе или не назначен вам");
      await tx.insert(orderEvents).values({orderId,actorId:cleanerId,eventType});
      if(updated.userId) {
        const messages:Record<string,string>={en_route:"Клинер выехал к вам.",arrived:"Клинер сообщил о прибытии."};
        void this.notifyTelegram(updated.userId,this.formatOrderNotice(to === "en_route" ? "🚗 <b>Клинер выехал</b>" : "📍 <b>Клинер прибыл</b>",updated,messages[to]??"Статус заказа обновлён."));
      }
      return updated;
    });
  }

  async startCleaning(orderId: string, cleanerId: string) {
    return db.transaction(async tx => {
      const [updated] = await tx.update(orders)
        .set({ status: "in_progress" })
        .where(and(eq(orders.id, orderId), eq(orders.cleanerId, cleanerId), eq(orders.status, "arrived")))
        .returning();
      if (!updated) throw new ConflictException("Заказ не назначен вам или уже начат");
      await tx.insert(orderEvents).values({ orderId, actorId: cleanerId, eventType: "cleaning_started" });
      if(updated.userId)void this.notifyTelegram(updated.userId,this.formatOrderNotice("🧽 <b>Уборка началась</b>",updated,"Исполнитель приступил к работе."));
      return updated;
    });
  }


  /** Send reminders independently of the cleaner. Never auto-confirm or pay an order. */
  private async processCompletionQueue() {
    const now = new Date();
    const waiting = await db.select({
      id: orders.id, userId: orders.userId, submittedAt: orders.completionSubmittedAt,
      reminderAt: orders.completionReminderAt, escalatedAt: orders.completionEscalatedAt,
    }).from(orders).where(eq(orders.status, "pending_confirmation")).limit(50);
    for (const order of waiting) {
      if (!order.submittedAt || !order.userId) continue;
      const elapsed = now.getTime() - order.submittedAt.getTime();
      if (elapsed >= 24 * 60 * 60_000 && !order.escalatedAt) {
        const [updated] = await db.update(orders).set({completionEscalatedAt: now})
          .where(and(eq(orders.id, order.id), eq(orders.status,"pending_confirmation"), isNull(orders.completionEscalatedAt))).returning({id:orders.id});
        if (updated) {
          await db.insert(orderEvents).values({orderId:order.id,eventType:"completion_support_escalated"});
          void this.notifyTelegram(order.userId,"⚠️ Подтверждение уборки ожидается более 24 часов. Заказ передан на рассмотрение поддержки CleanGo.");
        }
      } else if (elapsed >= 15 * 60_000 && !order.reminderAt) {
        const [updated] = await db.update(orders).set({completionReminderAt:now})
          .where(and(eq(orders.id,order.id),eq(orders.status,"pending_confirmation"),isNull(orders.completionReminderAt))).returning({id:orders.id});
        if (updated) {
          await db.insert(orderEvents).values({orderId:order.id,eventType:"completion_reminder_sent"});
          void this.notifyTelegram(order.userId,"🧹 Клинер завершил уборку. Пожалуйста, проверьте результат в CleanGo и подтвердите выполнение или сообщите о проблеме.");
        }
      }
    }
  }

  /** Client chooses the inspection method; photographs are the safe default. */
  async setInspectionMethod(orderId:string, clientId:string, method:"personal"|"photos") {
    if (!["personal","photos"].includes(method)) throw new BadRequestException("Некорректный способ проверки");
    const [updated] = await db.update(orders).set({inspectionMethod:method})
      .where(and(eq(orders.id,orderId),eq(orders.userId,clientId),
        inArray(orders.status,["accepted","en_route","arrived","in_progress"]))).returning();
    if (!updated) throw new ConflictException("Выбрать проверку можно только до завершения назначенной уборки");
    await db.insert(orderEvents).values({orderId,actorId:clientId,eventType:"inspection_method_updated"});
    return {inspectionMethod:updated.inspectionMethod};
  }

  async confirmCompletion(orderId:string, clientId:string) {
    const updated=await db.transaction(async tx=>{
      const [order] = await tx.update(orders).set({status:"completed",clientConfirmedAt:new Date()})
        .where(and(eq(orders.id,orderId),eq(orders.userId,clientId),eq(orders.status,"pending_confirmation"))).returning();
      if(!order)throw new ConflictException("Уборка не ожидает подтверждения");
      await tx.insert(orderEvents).values({orderId,actorId:clientId,eventType:"completion_confirmed"});
      return order;
    });
    if(updated.cleanerId)void this.notifyTelegram(updated.cleanerId,"✅ Клиент подтвердил выполнение уборки. Заказ завершён.");
    return {status:updated.status,clientConfirmedAt:updated.clientConfirmedAt};
  }

  async reportCompletionIssue(orderId:string,clientId:string) {
    await db.transaction(async tx=>{
      const [updated] = await tx.update(orders).set({status:"disputed",completionIssueAt:new Date()})
        .where(and(eq(orders.id,orderId),eq(orders.userId,clientId),eq(orders.status,"pending_confirmation"))).returning({id:orders.id});
      if(!updated)throw new ConflictException("Обращение возможно во время ожидания подтверждения");
      await tx.insert(orderEvents).values({orderId,actorId:clientId,eventType:"completion_issue_reported"});
    });
    return {status:"disputed",message:"Обращение зарегистрировано для рассмотрения поддержкой. Автоматической выплаты нет."};
  }

  async leaveReview(orderId:string,clientId:string,rating:number,reviewText?:string) {
    if(!Number.isInteger(rating)||rating<1||rating>5)throw new BadRequestException("Оценка от 1 до 5");
    if(reviewText && reviewText.length>1000)throw new BadRequestException("Отзыв слишком длинный");
    await db.transaction(async tx=>{
      const [updated] = await tx.update(orders).set({rating,reviewText:reviewText?.trim()||null,reviewedAt:new Date()})
        .where(and(eq(orders.id,orderId),eq(orders.userId,clientId),eq(orders.status,"completed"),isNull(orders.reviewedAt))).returning({id:orders.id});
      if(!updated)throw new ConflictException("Отзыв уже оставлен или заказ не завершён");
      await tx.insert(orderEvents).values({orderId,actorId:clientId,eventType:"review_submitted"});
    });
    return {rating,reviewText:reviewText?.trim()||null};
  }

  async cleanerReputation(cleanerId:string) {
    const rows = await db.select({rating:orders.rating,reviewText:orders.reviewText,reviewedAt:orders.reviewedAt})
      .from(orders).where(and(eq(orders.cleanerId,cleanerId),eq(orders.status,"completed")));
    const reviews=rows.filter(x=>x.rating!=null);
    return {completedOrders:rows.length,reviewCount:reviews.length,
      rating:reviews.length?Number((reviews.reduce((s,x)=>s+(x.rating??0),0)/reviews.length).toFixed(2)):null,
      reviews:reviews.filter(x=>x.reviewText).sort((a,b)=>(b.reviewedAt?.getTime()??0)-(a.reviewedAt?.getTime()??0)).slice(0,20)};
  }

  async completeCleaning(orderId: string, cleanerId: string, photos: string[] = []) {
    // Store small private photo reports in PostgreSQL for MVP. No public image URLs.
    if (!Array.isArray(photos)) throw new BadRequestException("Некорректные фотографии");
    for(const photo of photos) {
      if(typeof photo!=="string" || photo.length>450000) throw new BadRequestException("Фотография слишком большая");
      const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
      if(!match) throw new BadRequestException("Формат фото: JPEG, PNG или WebP");
      const bytes=Buffer.from(match[2],"base64");
      if(bytes.length>320000 || bytes.length<100 || !(
        (bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff) ||
        (bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47) ||
        (bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP")
      )) throw new BadRequestException("Фото повреждено или превышает 320 КБ");
    }
    const [current]=await db.select({inspectionMethod:orders.inspectionMethod}).from(orders)
      .where(and(eq(orders.id,orderId),eq(orders.cleanerId,cleanerId),eq(orders.status,"in_progress"))).limit(1);
    if(!current) throw new ConflictException("Завершить можно только свою выполняемую уборку");
    if(current.inspectionMethod==="photos" && (photos.length<3 || photos.length>5))
      throw new BadRequestException("Для дистанционной проверки нужны 3–5 фотографий");
    if(current.inspectionMethod==="personal" && photos.length>5)
      throw new BadRequestException("Не больше 5 фотографий");
    const submitted = await db.transaction(async tx => {
      const [updated] = await tx.update(orders)
        .set({ status: "pending_confirmation", completionPhotos:photos, completionSubmittedAt:new Date() })
        .where(and(eq(orders.id, orderId), eq(orders.cleanerId, cleanerId), eq(orders.status, "in_progress"),eq(orders.inspectionMethod,current.inspectionMethod)))
        .returning();
      if (!updated) throw new ConflictException("Завершить можно только свою выполняемую уборку");
      await tx.insert(orderEvents).values({ orderId, actorId: cleanerId, eventType: "cleaning_completed" });
      return updated;
    });
    if(submitted.userId)void this.notifyTelegram(submitted.userId,this.formatOrderNotice("✨ <b>Клинер закончил уборку</b>",submitted,"Проверьте результат и подтвердите его в CleanGo либо сообщите о проблеме."));
    return submitted;
  }

  /** Client-visible aggregate counts, never identities or coordinates of candidate cleaners. */
  async getMatchingProgress(orderId: string, clientId: string) {
    const [order] = await db.select({ id: orders.id, status: orders.status, cleanerId: orders.cleanerId, travelMode:orders.travelMode, etaMinutes:orders.etaMinutes, etaCalculatedAt:orders.etaCalculatedAt })
      .from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, clientId))).limit(1);
    if (!order) return null;
    const now = new Date();
    const offers = await db.select({ status: orderOffers.status, expiresAt: orderOffers.expiresAt })
      .from(orderOffers).where(eq(orderOffers.orderId, orderId));
    const sent = offers.length;
    const declined = offers.filter(offer => offer.status === "declined").length;
    const awaiting = offers.filter(offer => offer.status === "offered" && offer.expiresAt > now).length;
    let cleaner: { name: string; phone: string | null } | null = null;
    if (order.cleanerId && ["accepted", "en_route", "arrived", "in_progress", "pending_confirmation", "completed", "disputed"].includes(order.status)) {
      const [user] = await db.select({ firstName: users.firstName, lastName: users.lastName, phone: users.phone })
        .from(users).where(eq(users.id, order.cleanerId)).limit(1);
      if (user) cleaner = { name: [user.firstName, user.lastName].filter(Boolean).join(" ") || "Исполнитель CleanGo", phone: user.phone };
    }
    let tripLocation: {latitude:number;longitude:number}|null=null;
    if(order.status==="en_route" && order.cleanerId) {
      const [event]=await db.select({eventType:orderEvents.eventType}).from(orderEvents)
        .where(and(eq(orderEvents.orderId,orderId),inArray(orderEvents.eventType,["trip_location_on","trip_location_off"])))
        .orderBy(desc(orderEvents.createdAt),desc(orderEvents.id)).limit(1);
      if(event?.eventType==="trip_location_on") {
        const [profile]=await db.select({latitude:cleanerProfiles.latitude,longitude:cleanerProfiles.longitude,lastLocationAt:cleanerProfiles.lastLocationAt})
          .from(cleanerProfiles).where(eq(cleanerProfiles.userId,order.cleanerId)).limit(1);
        if(profile?.latitude!=null && profile.longitude!=null && profile.lastLocationAt && Date.now()-profile.lastLocationAt.getTime()<30_000) {
          tripLocation={latitude:Number(profile.latitude),longitude:Number(profile.longitude)};
        }
      }
    }
    return { status: order.status, sent, declined, awaiting, cleaner, tripLocation, travelMode:order.travelMode, etaMinutes:order.etaMinutes, etaCalculatedAt:order.etaCalculatedAt };
  }

  async findCleanerJobs(cleanerId: string) {
    return db.select({
      id: orders.id, status: orders.status, cleaningType: orders.cleaningType,
      area: orders.area, price: orders.price, address: orders.address,
      createdAt: orders.createdAt, latitude: orders.latitude, longitude: orders.longitude, clientFirstName: users.firstName,
      clientLastName: users.lastName, clientPhone: users.phone, inspectionMethod:orders.inspectionMethod,
    }).from(orders).leftJoin(users, eq(orders.userId, users.id))
      .where(and(eq(orders.cleanerId, cleanerId), sql`${orders.status} IN ('accepted', 'en_route', 'arrived', 'in_progress')`))
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

  async cancelByClient(orderId: string, clientId: string) {
    return db.transaction(async tx => {
      const now = new Date();
      const [cancelled] = await tx.update(orders)
        .set({ status: "cancelled" })
        .where(and(
          eq(orders.id, orderId),
          eq(orders.userId, clientId),
          eq(orders.status, "pending"),
          isNull(orders.cleanerId),
        ))
        .returning();
      if (!cancelled) throw new ConflictException("Отменить можно только свой заказ до принятия клинером");

      await tx.update(orderOffers)
        .set({ status: "revoked", respondedAt: now })
        .where(and(eq(orderOffers.orderId, orderId), eq(orderOffers.status, "offered")));

      await tx.insert(orderEvents).values({
        orderId, actorId: clientId, eventType: "order_cancelled",
      });
      return cancelled;
    });
  }

  async findMinePage(userId: string, section: "active" | "archive", page: number) {
    const terminal = ["completed", "cancelled", "unassigned", "expired", "failed", "no_cleaner", "disputed"];
    const condition = and(eq(orders.userId, userId), section === "archive"
      ? inArray(orders.status, terminal)
      : sql`${orders.status} NOT IN ('completed', 'cancelled', 'unassigned', 'expired', 'failed', 'no_cleaner')`);
    const [totalRow] = await db.select({ total: count() }).from(orders).where(condition);
    const items = await db.select().from(orders).where(condition)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(5).offset((page - 1) * 5);
    return { items, page, pageSize: 5, total: totalRow?.total ?? 0, hasMore: page * 5 < (totalRow?.total ?? 0) };
  }

  async findOneForClient(orderId: string, clientId: string) {
    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, clientId))).limit(1);
    return order ?? null;
  }

  async findByUserId(userId: string) {
    return db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt));
  }
}
