import { vi, expect, it, describe, beforeEach } from 'vitest';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
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
    findCleanerJobs: vi.fn(),
    findMinePage:vi.fn(),
    findCleanerHistory:vi.fn(),
    findCleanerHistoryDetail:vi.fn(),
    startCleaning: vi.fn(),
    completeCleaning: vi.fn(),
    leaveReview: vi.fn(),
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

  it('allows a verified cleaner to manage only their own assigned jobs through scoped service calls', async () => {
    const request = { user: { id: 'cleaner-1', role: 'cleaner', phoneVerifiedAt: new Date() } };
    ordersServiceMock.findCleanerJobs.mockResolvedValue([{ id: 'job-1' }]);
    ordersServiceMock.startCleaning.mockResolvedValue({ id: 'job-1', status: 'in_progress' });
    ordersServiceMock.completeCleaning.mockResolvedValue({ id: 'job-1', status: 'pending_confirmation' });
    await expect(controller.findCleanerJobs(request as never)).resolves.toEqual([{ id: 'job-1' }]);
    await expect(controller.startCleaning('job-1', request as never)).resolves.toMatchObject({ status: 'in_progress' });
    await expect(controller.completeCleaning('job-1', request as never)).resolves.toMatchObject({ status: 'pending_confirmation' });
    expect(ordersServiceMock.findCleanerJobs).toHaveBeenCalledWith('cleaner-1');
    expect(ordersServiceMock.startCleaning).toHaveBeenCalledWith('job-1', 'cleaner-1');
    expect(ordersServiceMock.completeCleaning).toHaveBeenCalledWith('job-1', 'cleaner-1', []);
  });

  it('rejects job transitions for clients and unverified cleaners', async () => {
    for (const user of [
      { id: 'client-1', role: 'client', phoneVerifiedAt: new Date() },
      { id: 'cleaner-2', role: 'cleaner', phoneVerifiedAt: null },
    ]) {
      await expect(controller.findCleanerJobs({ user } as never)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.startCleaning('job-1', { user } as never)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.completeCleaning('job-1', { user } as never)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(ordersServiceMock.startCleaning).not.toHaveBeenCalled();
    expect(ordersServiceMock.completeCleaning).not.toHaveBeenCalled();
  });


  it('allows a confirmed client to rate in half-star increments', async () => {
    const request = { user: { id: 'client-1', role: 'client', phoneVerifiedAt: new Date() } };
    ordersServiceMock.leaveReview.mockResolvedValue({ rating: 4.5 });
    await expect(controller.review('job-1', request as never, {rating:4.5})).resolves.toEqual({rating:4.5});
    expect(ordersServiceMock.leaveReview).toHaveBeenCalledExactlyOnceWith('job-1', 'client-1', 4.5, undefined);
    await expect(controller.review('job-1', request as never, {rating:4.3})).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.review('job-1', request as never, {rating:0})).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.review('job-1', request as never, {rating:5.5})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('denies accepting and declining offers to clients', async () => {
    const request = { user: { id: 'client-1', role: 'client', phoneVerifiedAt: new Date() } };
    await expect(controller.accept('order-1', request as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.decline('order-1', request as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(ordersServiceMock.accept).not.toHaveBeenCalled();
    expect(ordersServiceMock.decline).not.toHaveBeenCalled();
  });

  it("scopes cleaner history and detail to the authenticated cleaner", async()=>{
    const request={user:{id:"cleaner-1",role:"cleaner",phoneVerifiedAt:new Date()}};
    ordersServiceMock.findCleanerHistory.mockResolvedValue({items:[],total:0});
    ordersServiceMock.findCleanerHistoryDetail.mockResolvedValue({id:"job-1",status:"pending_confirmation"});
    await expect(controller.cleanerHistory(request as never,"2")).resolves.toEqual({items:[],total:0});
    await expect(controller.cleanerHistoryDetail("job-1",request as never)).resolves.toMatchObject({status:"pending_confirmation"});
    expect(ordersServiceMock.findCleanerHistory).toHaveBeenCalledWith("cleaner-1",2);
    expect(ordersServiceMock.findCleanerHistoryDetail).toHaveBeenCalledWith("cleaner-1","job-1");
    ordersServiceMock.findCleanerHistoryDetail.mockResolvedValue(null);
    await expect(controller.cleanerHistoryDetail("other-job",request as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.cleanerHistory(request as never,"0")).rejects.toBeInstanceOf(BadRequestException);
    for(const user of [{id:"client-1",role:"client",phoneVerifiedAt:new Date()},{id:"cleaner-2",role:"cleaner",phoneVerifiedAt:null}]){
      await expect(controller.cleanerHistory({user} as never)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.cleanerHistoryDetail("job-1",{user} as never)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it("validates and scopes client history sections",async()=>{
    const request={user:{id:"client-1",role:"client",phoneVerifiedAt:new Date()}};
    ordersServiceMock.findMinePage.mockResolvedValue({items:[],total:0});
    for(const section of ["active","completed","cancelled","archive"]){
      await expect(controller.history(request as never,section,"1")).resolves.toEqual({items:[],total:0});
      expect(ordersServiceMock.findMinePage).toHaveBeenLastCalledWith("client-1",section,1);
    }
    await expect(controller.history(request as never,"all","1")).rejects.toBeInstanceOf(BadRequestException);
  });

});
