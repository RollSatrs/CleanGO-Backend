import { vi, expect, it, describe, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { AuthGuard } from '../auth/auth.guard.js';

describe('OrdersController', () => {
  let controller: OrdersController;

  const ordersServiceMock = {
    create: vi.fn(),
    accept: vi.fn(),
    decline: vi.fn(),
    findActiveOffers: vi.fn(),
    findByUserId: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: ordersServiceMock }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: vi.fn().mockResolvedValue(true) })
      .compile();

    controller = module.get<OrdersController>(OrdersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns only the authenticated cleaner\'s offers', async () => {
    const offers = [{ offerId: 'offer-1', orderId: 'order-1', approximateArea: 'Center' }];
    ordersServiceMock.findActiveOffers.mockResolvedValue(offers);
    const request = { user: { id: 'cleaner-1', role: 'cleaner', phoneVerifiedAt: new Date() } };
    await expect(controller.findMyOffers(request as never)).resolves.toEqual(offers);
    expect(ordersServiceMock.findActiveOffers).toHaveBeenCalledExactlyOnceWith('cleaner-1');
  });

  it('denies offers to clients and unverified cleaners', async () => {
    for (const user of [
      { id: 'client-1', role: 'client', phoneVerifiedAt: new Date() },
      { id: 'cleaner-2', role: 'cleaner', phoneVerifiedAt: null },
    ]) {
      await expect(controller.findMyOffers({ user } as never)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(ordersServiceMock.findActiveOffers).not.toHaveBeenCalled();
  });

  it('denies accepting and declining offers to clients', async () => {
    const request = { user: { id: 'client-1', role: 'client', phoneVerifiedAt: new Date() } };
    await expect(controller.accept('order-1', request as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.decline('order-1', request as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(ordersServiceMock.accept).not.toHaveBeenCalled();
    expect(ordersServiceMock.decline).not.toHaveBeenCalled();
  });
});
