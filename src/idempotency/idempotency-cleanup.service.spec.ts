import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';
import { HttpIdempotencyEntity } from './idempotency.entity';

describe('IdempotencyCleanupService', () => {
  let service: IdempotencyCleanupService;
  let repo: {
    delete: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyCleanupService,
        { provide: getRepositoryToken(HttpIdempotencyEntity), useValue: repo },
      ],
    }).compile();

    service = module.get(IdempotencyCleanupService);
  });

  describe('purgeExpiredKeys', () => {
    it('deletes records older than 24 hours', async () => {
      repo.delete.mockResolvedValue({ affected: 5 });
      await service.purgeExpiredKeys();
      expect(repo.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          createdAt: expect.anything(),
        }),
      );
    });

    it('handles zero affected rows gracefully', async () => {
      repo.delete.mockResolvedValue({ affected: 0 });
      await service.purgeExpiredKeys();
      expect(repo.delete).toHaveBeenCalled();
    });

    it('handles database errors without throwing', async () => {
      repo.delete.mockRejectedValue(new Error('DB connection failed'));
      await expect(service.purgeExpiredKeys()).resolves.not.toThrow();
    });
  });

  describe('runManualCleanup', () => {
    it('deletes expired keys with default TTL', async () => {
      repo.delete.mockResolvedValue({ affected: 3 });
      const result = await service.runManualCleanup();
      expect(result).toBe(3);
    });

    it('uses custom TTL when provided', async () => {
      repo.delete.mockResolvedValue({ affected: 1 });
      const customTtl = 1 * 60 * 60 * 1000; // 1 hour
      const result = await service.runManualCleanup(customTtl);
      expect(result).toBe(1);
      expect(repo.delete).toHaveBeenCalled();
    });

    it('returns 0 when no keys expired', async () => {
      repo.delete.mockResolvedValue({ affected: 0 });
      const result = await service.runManualCleanup();
      expect(result).toBe(0);
    });

    it('returns 0 when affected is undefined', async () => {
      repo.delete.mockResolvedValue({});
      const result = await service.runManualCleanup();
      expect(result).toBe(0);
    });
  });
});
