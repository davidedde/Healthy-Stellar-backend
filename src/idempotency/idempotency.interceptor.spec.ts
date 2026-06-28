import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CallHandler, ExecutionContext, UnprocessableEntityException } from '@nestjs/common';
import { of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { HttpIdempotencyEntity } from './idempotency.entity';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let repo: {
    findOne: jest.Mock;
    upsert: jest.Mock;
    delete: jest.Mock;
  };

  const createMockContext = (
    method: string,
    path: string,
    headers: Record<string, string> = {},
    user?: { id: string },
  ): ExecutionContext => {
    const request = {
      method,
      path,
      headers,
      user,
    };
    const response = {
      statusCode: 200,
      setHeader: jest.fn(),
      getHeader: jest.fn().mockReturnValue(null),
      status: jest.fn(),
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
  };

  const createMockCallHandler = (body: any = { id: '1' }): CallHandler => ({
    handle: () => of(body),
  });

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyInterceptor,
        { provide: getRepositoryToken(HttpIdempotencyEntity), useValue: repo },
      ],
    }).compile();

    interceptor = module.get(IdempotencyInterceptor);
  });

  it('passes through GET requests without checking idempotency', async () => {
    const ctx = createMockContext('GET', '/api/records');
    const handler = createMockCallHandler();

    const result$ = await interceptor.intercept(ctx, handler);
    const value = await result$.toPromise();

    expect(value).toEqual({ id: '1' });
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('passes through POST without idempotency header', async () => {
    const ctx = createMockContext('POST', '/api/records');
    const handler = createMockCallHandler();

    const result$ = await interceptor.intercept(ctx, handler);
    const value = await result$.toPromise();

    expect(value).toEqual({ id: '1' });
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('throws UnprocessableEntityException for key longer than 256 chars', async () => {
    const longKey = 'a'.repeat(257);
    const ctx = createMockContext('POST', '/api/records', {
      'idempotency-key': longKey,
    });
    const handler = createMockCallHandler();

    await expect(interceptor.intercept(ctx, handler)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('replays cached response for duplicate key', async () => {
    const existing = {
      key: 'global:anonymous:key-1',
      statusCode: 201,
      body: { id: 'created-id' },
      headers: { 'content-type': 'application/json' },
      requestFingerprint: 'POST:/api/records',
      createdAt: new Date(),
    } as HttpIdempotencyEntity;
    repo.findOne.mockResolvedValue(existing);

    const ctx = createMockContext('POST', '/api/records', {
      'idempotency-key': 'key-1',
    });
    const response = ctx.switchToHttp().getResponse();
    const handler = createMockCallHandler();

    const result$ = await interceptor.intercept(ctx, handler);
    const value = await result$.toPromise();

    expect(value).toEqual({ id: 'created-id' });
    expect((response as any).setHeader).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
    expect((response as any).status).toHaveBeenCalledWith(201);
  });

  it('throws UnprocessableEntityException for fingerprint mismatch', async () => {
    const existing = {
      key: 'global:anonymous:key-1',
      statusCode: 200,
      body: {},
      headers: {},
      requestFingerprint: 'PUT:/api/other',
      createdAt: new Date(),
    } as HttpIdempotencyEntity;
    repo.findOne.mockResolvedValue(existing);

    const ctx = createMockContext('POST', '/api/records', {
      'idempotency-key': 'key-1',
    });
    const handler = createMockCallHandler();

    await expect(interceptor.intercept(ctx, handler)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('deletes expired keys and processes as new', async () => {
    const expired = {
      key: 'global:anonymous:key-1',
      statusCode: 200,
      body: {},
      headers: {},
      requestFingerprint: 'POST:/api/records',
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
    } as HttpIdempotencyEntity;
    repo.findOne.mockResolvedValue(expired);

    const ctx = createMockContext('POST', '/api/records', {
      'idempotency-key': 'key-1',
    });
    const handler = createMockCallHandler();

    const result$ = await interceptor.intercept(ctx, handler);
    const value = await result$.toPromise();

    expect(repo.delete).toHaveBeenCalledWith({ key: 'global:anonymous:key-1' });
    expect(value).toEqual({ id: '1' });
  });

  it('stores new response in repository', async () => {
    repo.findOne.mockResolvedValue(null);

    const ctx = createMockContext('POST', '/api/records', {
      'idempotency-key': 'new-key',
    });
    const handler = createMockCallHandler({ id: 'new-id' });

    const result$ = await interceptor.intercept(ctx, handler);
    await result$.toPromise();

    // Wait for tap operator to persist
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'global:anonymous:new-key',
        requestFingerprint: 'POST:/api/records',
      }),
      ['key'],
    );
  });

  it('uses tenant and user IDs in composite key', async () => {
    repo.findOne.mockResolvedValue(null);

    const ctx = createMockContext(
      'POST',
      '/api/records',
      { 'idempotency-key': 'my-key', 'x-tenant-id': 'tenant-1' },
      { id: 'user-1' },
    );
    const handler = createMockCallHandler();

    const result$ = await interceptor.intercept(ctx, handler);
    await result$.toPromise();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'tenant-1:user-1:my-key' }),
      ['key'],
    );
  });
});
