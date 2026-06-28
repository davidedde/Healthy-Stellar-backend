import {
  QuotaRedisKeys,
  monthKey,
  hourKey,
  secondsUntilMonthEnd,
  secondsUntilNextHour,
} from './quota-redis-keys';

describe('QuotaRedisKeys', () => {
  describe('monthlyRecords', () => {
    it('generates correct key pattern', () => {
      const key = QuotaRedisKeys.monthlyRecords('tenant-1');
      expect(key).toMatch(/^quota:tenant-1:records:\d{4}-\d{2}$/);
    });
  });

  describe('hourlyApiCalls', () => {
    it('generates correct key pattern', () => {
      const key = QuotaRedisKeys.hourlyApiCalls('tenant-1');
      expect(key).toMatch(/^quota:tenant-1:api_calls:\d{4}-\d{2}-\d{2}-\d{2}$/);
    });
  });

  describe('bulkOperations', () => {
    it('generates correct key pattern', () => {
      const key = QuotaRedisKeys.bulkOperations('tenant-1');
      expect(key).toBe('quota:tenant-1:bulk_ops');
    });
  });

  describe('storageBytes', () => {
    it('generates correct key pattern', () => {
      const key = QuotaRedisKeys.storageBytes('tenant-1');
      expect(key).toBe('quota:tenant-1:storage_bytes');
    });
  });
});

describe('monthKey', () => {
  it('returns YYYY-MM format', () => {
    const result = monthKey();
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('hourKey', () => {
  it('returns YYYY-MM-DD-HH format', () => {
    const result = hourKey();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}$/);
  });
});

describe('secondsUntilMonthEnd', () => {
  it('returns a positive number', () => {
    const result = secondsUntilMonthEnd();
    expect(result).toBeGreaterThan(0);
  });

  it('is less than or equal to 31 days in seconds', () => {
    const result = secondsUntilMonthEnd();
    expect(result).toBeLessThanOrEqual(31 * 24 * 60 * 60);
  });
});

describe('secondsUntilNextHour', () => {
  it('returns a positive number', () => {
    const result = secondsUntilNextHour();
    expect(result).toBeGreaterThan(0);
  });

  it('is less than or equal to 3600', () => {
    const result = secondsUntilNextHour();
    expect(result).toBeLessThanOrEqual(3600);
  });
});
