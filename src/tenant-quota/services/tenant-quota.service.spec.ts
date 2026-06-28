import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

jest.mock('@nestjs-modules/ioredis', () => ({
  InjectRedis: () => (_target: any, _key: string | symbol, index: number) => {
    // Parameter decorator no-op for test DI
  },
}));

import { TenantQuotaService } from './tenant-quota.service';
import { TenantQuota } from '../entities/tenant-quota.entity';
import { QUOTA_TIER_DEFAULTS } from '../interfaces/quota-tier.interface';

describe('TenantQuotaService', () => {
  let service: TenantQuotaService;
  let quotaRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    incr: jest.Mock;
    incrby: jest.Mock;
    decrby: jest.Mock;
    decr: jest.Mock;
    del: jest.Mock;
    expire: jest.Mock;
  };

  const freeQuota = {
    tenantId: 'tenant-1',
    tier: 'free',
    customRecordsPerMonth: null,
    customStorageBytes: null,
    customApiCallsPerHour: null,
    customBulkOperationsConcurrent: null,
  } as unknown as TenantQuota;

  beforeEach(() => {
    quotaRepo = {
      findOne: jest.fn().mockResolvedValue(freeQuota),
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      incr: jest.fn().mockResolvedValue(1),
      incrby: jest.fn().mockResolvedValue(1),
      decrby: jest.fn().mockResolvedValue(0),
      decr: jest.fn().mockResolvedValue(0),
      del: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };

    // Directly instantiate to bypass @InjectRedis decorator DI
    service = new TenantQuotaService(quotaRepo as any, redis as any);
  });

  describe('checkRecordQuota', () => {
    it('returns allowed when under limit', async () => {
      redis.get.mockResolvedValue('10');
      const result = await service.checkRecordQuota('tenant-1');
      expect(result.allowed).toBe(true);
      expect(result.used).toBe(10);
      expect(result.limit).toBe(QUOTA_TIER_DEFAULTS.free.recordsPerMonth);
      expect(result.quotaType).toBe('records');
    });

    it('returns not allowed when at limit', async () => {
      redis.get.mockResolvedValue(String(QUOTA_TIER_DEFAULTS.free.recordsPerMonth));
      const result = await service.checkRecordQuota('tenant-1');
      expect(result.allowed).toBe(false);
    });

    it('returns allowed for 0 usage', async () => {
      redis.get.mockResolvedValue(null);
      const result = await service.checkRecordQuota('tenant-1');
      expect(result.allowed).toBe(true);
      expect(result.used).toBe(0);
    });
  });

  describe('checkAndIncrementApiCall', () => {
    it('atomically increments and returns pre-increment count', async () => {
      redis.incr.mockResolvedValue(1);
      const result = await service.checkAndIncrementApiCall('tenant-1');
      expect(result.allowed).toBe(true);
      expect(result.used).toBe(0);
      expect(redis.incr).toHaveBeenCalled();
    });

    it('sets TTL on first write', async () => {
      redis.incr.mockResolvedValue(1);
      await service.checkAndIncrementApiCall('tenant-1');
      expect(redis.expire).toHaveBeenCalled();
    });

    it('does not set TTL on subsequent writes', async () => {
      redis.incr.mockResolvedValue(5);
      await service.checkAndIncrementApiCall('tenant-1');
      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('returns not allowed when at limit', async () => {
      redis.incr.mockResolvedValue(QUOTA_TIER_DEFAULTS.free.apiCallsPerHour + 1);
      const result = await service.checkAndIncrementApiCall('tenant-1');
      expect(result.allowed).toBe(false);
    });
  });

  describe('incrementRecords', () => {
    it('increments by specified amount', async () => {
      redis.incrby.mockResolvedValue(5);
      await service.incrementRecords('tenant-1', 5);
      expect(redis.incrby).toHaveBeenCalledWith(expect.any(String), 5);
    });

    it('sets TTL on first month write', async () => {
      redis.incrby.mockResolvedValue(1);
      await service.incrementRecords('tenant-1', 1);
      expect(redis.expire).toHaveBeenCalled();
    });

    it('does not set TTL on subsequent writes', async () => {
      redis.incrby.mockResolvedValue(10);
      await service.incrementRecords('tenant-1', 5);
      expect(redis.expire).not.toHaveBeenCalled();
    });
  });

  describe('decrementRecords', () => {
    it('decrements when current count is positive', async () => {
      redis.get.mockResolvedValue('10');
      await service.decrementRecords('tenant-1', 3);
      expect(redis.decrby).toHaveBeenCalledWith(expect.any(String), 3);
    });

    it('does not decrement when current count is 0', async () => {
      redis.get.mockResolvedValue('0');
      await service.decrementRecords('tenant-1', 1);
      expect(redis.decrby).not.toHaveBeenCalled();
    });

    it('caps decrement at current count', async () => {
      redis.get.mockResolvedValue('2');
      await service.decrementRecords('tenant-1', 5);
      expect(redis.decrby).toHaveBeenCalledWith(expect.any(String), 2);
    });
  });

  describe('checkBulkOperationQuota', () => {
    it('returns allowed when no active operations', async () => {
      redis.get.mockResolvedValue(null);
      const result = await service.checkBulkOperationQuota('tenant-1');
      expect(result.allowed).toBe(true);
      expect(result.quotaType).toBe('bulkOperations');
    });

    it('returns not allowed when at limit', async () => {
      redis.get.mockResolvedValue(String(QUOTA_TIER_DEFAULTS.free.bulkOperationsConcurrent));
      const result = await service.checkBulkOperationQuota('tenant-1');
      expect(result.allowed).toBe(false);
    });
  });

  describe('adjustStorageBytes', () => {
    it('increments storage for positive delta', async () => {
      await service.adjustStorageBytes('tenant-1', 1024);
      expect(redis.incrby).toHaveBeenCalledWith(expect.any(String), 1024);
    });

    it('decreases storage for negative delta, clamping at 0', async () => {
      redis.get.mockResolvedValue('500');
      await service.adjustStorageBytes('tenant-1', -1000);
      expect(redis.set).toHaveBeenCalledWith(expect.any(String), 0);
    });

    it('does nothing for zero delta', async () => {
      await service.adjustStorageBytes('tenant-1', 0);
      expect(redis.incrby).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('resetCounters', () => {
    it('deletes all Redis counter keys for the tenant', async () => {
      await service.resetCounters('tenant-1');
      expect(redis.del).toHaveBeenCalled();
    });
  });

  describe('updateQuota', () => {
    it('updates quota with provided DTO', async () => {
      const dto = { tier: 'professional' } as any;
      quotaRepo.save.mockResolvedValue({ ...freeQuota, ...dto });
      const result = await service.updateQuota('tenant-1', dto);
      expect(quotaRepo.save).toHaveBeenCalled();
    });
  });

  describe('findOrCreateQuota (via checkRecordQuota)', () => {
    it('creates a free-tier quota when none exists', async () => {
      quotaRepo.findOne.mockResolvedValue(null);
      quotaRepo.create.mockReturnValue({ tenantId: 'new-tenant', tier: 'free' });
      quotaRepo.save.mockResolvedValue({
        tenantId: 'new-tenant',
        tier: 'free',
        customRecordsPerMonth: null,
        customStorageBytes: null,
        customApiCallsPerHour: null,
        customBulkOperationsConcurrent: null,
      });

      redis.get.mockResolvedValue(null);
      const result = await service.checkRecordQuota('new-tenant');

      expect(quotaRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'new-tenant', tier: 'free' }),
      );
      expect(result.limit).toBe(QUOTA_TIER_DEFAULTS.free.recordsPerMonth);
    });
  });
});
