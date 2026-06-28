import { NotFoundException } from '@nestjs/common';
import { IncidentEvidenceService } from './incident-evidence.service';
import {
  IncidentEvidenceEntity,
  IncidentSeverity,
  IncidentStatus,
} from './entities/incident-evidence.entity';

describe('IncidentEvidenceService', () => {
  let service: IncidentEvidenceService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };

  const makeQueue = () => ({
    getWaitingCount: jest.fn().mockResolvedValue(0),
    getActiveCount: jest.fn().mockResolvedValue(0),
    getFailedCount: jest.fn().mockResolvedValue(0),
    getDelayedCount: jest.fn().mockResolvedValue(0),
  });

  const mockTracingService = {
    getCurrentTraceContext: jest.fn().mockReturnValue({
      traceId: 'trace-123',
      spanId: 'span-456',
    }),
  };

  const makeIncident = (overrides: Partial<IncidentEvidenceEntity> = {}) =>
    ({
      id: 'inc-1',
      title: 'Test Incident',
      description: 'Something went wrong',
      severity: IncidentSeverity.HIGH,
      status: IncidentStatus.OPEN,
      triggeredBy: 'system',
      notes: null,
      capturedAt: new Date(),
      ...overrides,
    }) as IncidentEvidenceEntity;

  beforeEach(() => {
    repo = {
      create: jest.fn((dto) => ({ id: 'inc-1', ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };

    const q = makeQueue();

    // Directly instantiate with constructor args to bypass @InjectQueue DI issues
    service = new IncidentEvidenceService(
      repo as any,
      mockTracingService as any,
      q as any, // stellar
      q as any, // contractWrites
      q as any, // ipfs
      q as any, // eventIndexing
      q as any, // email
      q as any, // reports
      q as any, // ehrImport
    );
  });

  describe('capture', () => {
    it('captures evidence with memory, CPU, queue, and log snapshots', async () => {
      const dto = {
        title: 'Queue backup',
        description: 'Stellar queue is backed up',
        severity: IncidentSeverity.HIGH,
        triggeredBy: 'monitor',
        metadata: { queueName: 'stellar' },
      };

      await service.capture(dto);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Queue backup',
          severity: IncidentSeverity.HIGH,
          status: IncidentStatus.OPEN,
          traceId: 'trace-123',
          memorySnapshot: expect.objectContaining({ rss: expect.any(Number) }),
          cpuSnapshot: expect.objectContaining({ user: expect.any(Number) }),
          queueSnapshot: expect.any(Object),
          recentLogs: expect.any(Array),
        }),
      );
      expect(repo.save).toHaveBeenCalled();
    });

    it('defaults severity to HIGH when not specified', async () => {
      const dto = {
        title: 'Test',
        description: 'Test',
        triggeredBy: 'test',
      };

      await service.capture(dto as any);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ severity: IncidentSeverity.HIGH }),
      );
    });
  });

  describe('list', () => {
    it('returns incidents with default limit', async () => {
      await service.list({});
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { capturedAt: 'DESC' },
          take: 20,
        }),
      );
    });

    it('filters by severity', async () => {
      await service.list({ severity: IncidentSeverity.CRITICAL });
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ severity: IncidentSeverity.CRITICAL }),
        }),
      );
    });

    it('filters by status', async () => {
      await service.list({ status: IncidentStatus.RESOLVED });
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: IncidentStatus.RESOLVED }),
        }),
      );
    });

    it('respects custom limit', async () => {
      await service.list({ limit: 5 });
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  describe('get', () => {
    it('returns incident when found', async () => {
      const incident = makeIncident();
      repo.findOne.mockResolvedValue(incident);
      const result = await service.get('inc-1');
      expect(result).toEqual(incident);
    });

    it('throws NotFoundException when not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.get('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolve', () => {
    it('sets status to RESOLVED with resolvedBy', async () => {
      const incident = makeIncident();
      repo.findOne.mockResolvedValue(incident);
      repo.save.mockResolvedValue(incident);

      await service.resolve('inc-1', { notes: 'Fixed the issue' }, 'admin-1');

      expect(incident.status).toBe(IncidentStatus.RESOLVED);
      expect(incident.resolvedBy).toBe('admin-1');
      expect(incident.resolvedAt).toBeDefined();
      expect(incident.notes).toBe('Fixed the issue');
    });

    it('appends notes to existing notes', async () => {
      const incident = makeIncident({ notes: 'Initial note' });
      repo.findOne.mockResolvedValue(incident);
      repo.save.mockResolvedValue(incident);

      await service.resolve('inc-1', { notes: 'Resolution' }, 'admin-1');

      expect(incident.notes).toBe('Initial note\nResolution');
    });
  });

  describe('addNotes', () => {
    it('appends notes and sets status to INVESTIGATING', async () => {
      const incident = makeIncident({ notes: 'First note' });
      repo.findOne.mockResolvedValue(incident);
      repo.save.mockResolvedValue(incident);

      await service.addNotes('inc-1', { notes: 'Investigation update' });

      expect(incident.notes).toBe('First note\nInvestigation update');
      expect(incident.status).toBe(IncidentStatus.INVESTIGATING);
    });

    it('sets notes directly when no existing notes', async () => {
      const incident = makeIncident({ notes: null });
      repo.findOne.mockResolvedValue(incident);
      repo.save.mockResolvedValue(incident);

      await service.addNotes('inc-1', { notes: 'First note' });

      expect(incident.notes).toBe('First note');
    });
  });
});
