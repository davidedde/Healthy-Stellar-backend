import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

jest.mock('@nestjs-modules/ioredis', () => ({
  InjectRedis: () => (_target: any, _key: string | symbol, index: number) => {},
}));

import { QuotaGuard } from './quota.guard';
import { TenantQuotaService } from '../services/tenant-quota.service';

describe('QuotaGuard', () => {
  let guard: QuotaGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let quotaService: {
    checkRecordQuota: jest.Mock;
    checkAndIncrementApiCall: jest.Mock;
    checkBulkOperationQuota: jest.Mock;
  };

  const createMockContext = (tenantId?: string, headerTenantId?: string): ExecutionContext => {
    const request = {
      user: tenantId ? { tenantId } : undefined,
      headers: headerTenantId ? { 'x-tenant-id': headerTenantId } : {},
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(null) };
    quotaService = {
      checkRecordQuota: jest.fn().mockResolvedValue({ allowed: true, used: 0, limit: 500, quotaType: 'records' }),
      checkAndIncrementApiCall: jest.fn().mockResolvedValue({ allowed: true, used: 0, limit: 100, quotaType: 'apiCalls' }),
      checkBulkOperationQuota: jest.fn().mockResolvedValue({ allowed: true, used: 0, limit: 1, quotaType: 'bulkOperations' }),
    };

    guard = new QuotaGuard(
      reflector as unknown as Reflector,
      quotaService as unknown as TenantQuotaService,
    );
  });

  it('allows request when no @EnforceQuota decorator present', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = createMockContext('tenant-1');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('allows request when tenantId is missing (fail open)', async () => {
    reflector.getAllAndOverride.mockReturnValue('records');
    const ctx = createMockContext(undefined);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('checks record quota when type is records', async () => {
    reflector.getAllAndOverride.mockReturnValue('records');
    const ctx = createMockContext('tenant-1');
    await guard.canActivate(ctx);
    expect(quotaService.checkRecordQuota).toHaveBeenCalledWith('tenant-1');
  });

  it('checks and increments API call quota', async () => {
    reflector.getAllAndOverride.mockReturnValue('apiCalls');
    const ctx = createMockContext('tenant-1');
    await guard.canActivate(ctx);
    expect(quotaService.checkAndIncrementApiCall).toHaveBeenCalledWith('tenant-1');
  });

  it('checks bulk operation quota', async () => {
    reflector.getAllAndOverride.mockReturnValue('bulkOperations');
    const ctx = createMockContext('tenant-1');
    await guard.canActivate(ctx);
    expect(quotaService.checkBulkOperationQuota).toHaveBeenCalledWith('tenant-1');
  });

  it('throws 429 when quota is exceeded', async () => {
    reflector.getAllAndOverride.mockReturnValue('records');
    quotaService.checkRecordQuota.mockResolvedValue({
      allowed: false,
      used: 500,
      limit: 500,
      quotaType: 'records',
    });
    const ctx = createMockContext('tenant-1');

    try {
      await guard.canActivate(ctx);
      fail('Expected HttpException to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const response = (err as HttpException).getResponse() as any;
      expect(response.details.quotaType).toBe('records');
      expect(response.details.used).toBe(500);
      expect(response.details.limit).toBe(500);
    }
  });

  it('allows request when quota is not exceeded', async () => {
    reflector.getAllAndOverride.mockReturnValue('records');
    quotaService.checkRecordQuota.mockResolvedValue({
      allowed: true,
      used: 100,
      limit: 500,
      quotaType: 'records',
    });
    const ctx = createMockContext('tenant-1');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('falls back to x-tenant-id header', async () => {
    reflector.getAllAndOverride.mockReturnValue('records');
    const ctx = createMockContext(undefined, 'header-tenant');
    await guard.canActivate(ctx);
    expect(quotaService.checkRecordQuota).toHaveBeenCalledWith('header-tenant');
  });

  it('fails open for unknown quota type', async () => {
    reflector.getAllAndOverride.mockReturnValue('unknown_type');
    const ctx = createMockContext('tenant-1');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });
});
