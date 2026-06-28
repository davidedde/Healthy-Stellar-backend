import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AdverseReactionService } from './adverse-reaction.service';
import {
  AdverseDrugReaction,
  ReactionSeverity,
  ReactionStatus,
} from '../entities/adverse-drug-reaction.entity';
import { AlertService } from './alert.service';

describe('AdverseReactionService', () => {
  let service: AdverseReactionService;
  let adrRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let alertService: {
    sendSevereAdverseReactionAlert: jest.Mock;
    sendPhysicianAdverseReactionNotification: jest.Mock;
    sendPharmacyAdverseReactionNotification: jest.Mock;
  };

  const makeAdr = (overrides: Partial<AdverseDrugReaction> = {}) =>
    ({
      id: 'adr-1',
      patientId: 'patient-1',
      medicationName: 'Penicillin',
      severity: ReactionSeverity.MILD,
      status: ReactionStatus.ACTIVE,
      reactionDate: new Date('2025-01-15T10:00:00Z'),
      reporterId: 'reporter-1',
      reporterName: 'Dr. Smith',
      reporterRole: 'physician',
      symptoms: 'Rash',
      fdaReported: false,
      ...overrides,
    }) as AdverseDrugReaction;

  beforeEach(async () => {
    adrRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    alertService = {
      sendSevereAdverseReactionAlert: jest.fn().mockResolvedValue(undefined),
      sendPhysicianAdverseReactionNotification: jest.fn().mockResolvedValue(undefined),
      sendPharmacyAdverseReactionNotification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdverseReactionService,
        { provide: getRepositoryToken(AdverseDrugReaction), useValue: adrRepo },
        { provide: AlertService, useValue: alertService },
      ],
    }).compile();

    service = module.get(AdverseReactionService);
  });

  describe('create', () => {
    const setupCreateMocks = (created: AdverseDrugReaction) => {
      adrRepo.create.mockReturnValue(created);
      adrRepo.save.mockResolvedValue(created);
      // notifyPhysician calls findOne twice (once in findOne, once for return)
      adrRepo.findOne.mockResolvedValue(created);
      adrRepo.update.mockResolvedValue({ affected: 1 });
    };

    it('creates and saves an adverse reaction', async () => {
      const dto = {
        patientId: 'patient-1',
        medicationName: 'Penicillin',
        reactionDate: '2025-01-15T10:00:00Z',
        severity: ReactionSeverity.MILD,
      } as any;

      const created = makeAdr();
      setupCreateMocks(created);

      const result = await service.create(dto);
      expect(adrRepo.save).toHaveBeenCalled();
    });

    it('sends alert for severe reactions', async () => {
      const dto = {
        patientId: 'patient-1',
        medicationName: 'Drug-X',
        reactionDate: '2025-01-15T10:00:00Z',
        severity: ReactionSeverity.SEVERE,
      } as any;

      const created = makeAdr({ severity: ReactionSeverity.SEVERE });
      setupCreateMocks(created);

      await service.create(dto);
      expect(alertService.sendSevereAdverseReactionAlert).toHaveBeenCalledWith(created);
    });

    it('sends alert for life-threatening reactions', async () => {
      const dto = {
        patientId: 'patient-1',
        medicationName: 'Drug-Y',
        reactionDate: '2025-01-15T10:00:00Z',
        severity: ReactionSeverity.LIFE_THREATENING,
      } as any;

      const created = makeAdr({ severity: ReactionSeverity.LIFE_THREATENING });
      setupCreateMocks(created);

      await service.create(dto);
      expect(alertService.sendSevereAdverseReactionAlert).toHaveBeenCalled();
    });

    it('does not send severe alert for mild reactions', async () => {
      const dto = {
        patientId: 'patient-1',
        medicationName: 'Aspirin',
        reactionDate: '2025-01-15T10:00:00Z',
        severity: ReactionSeverity.MILD,
      } as any;

      const created = makeAdr({ severity: ReactionSeverity.MILD });
      setupCreateMocks(created);

      await service.create(dto);
      expect(alertService.sendSevereAdverseReactionAlert).not.toHaveBeenCalled();
    });

    it('notifies physician for all reactions', async () => {
      const dto = {
        patientId: 'patient-1',
        medicationName: 'Aspirin',
        reactionDate: '2025-01-15T10:00:00Z',
        severity: ReactionSeverity.MILD,
      } as any;

      const created = makeAdr();
      setupCreateMocks(created);

      await service.create(dto);
      expect(alertService.sendPhysicianAdverseReactionNotification).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the reaction when found', async () => {
      const adr = makeAdr();
      adrRepo.findOne.mockResolvedValue(adr);
      const result = await service.findOne('adr-1');
      expect(result).toEqual(adr);
    });

    it('throws NotFoundException when not found', async () => {
      adrRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByPatient', () => {
    it('returns reactions for a patient', async () => {
      const reactions = [makeAdr()];
      adrRepo.find.mockResolvedValue(reactions);
      const result = await service.findByPatient('patient-1');
      expect(result).toEqual(reactions);
    });
  });

  describe('findActiveReactions', () => {
    it('queries for active reactions', async () => {
      await service.findActiveReactions();
      expect(adrRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: ReactionStatus.ACTIVE } }),
      );
    });
  });

  describe('resolveReaction', () => {
    it('updates status to RESOLVED with outcome', async () => {
      const adr = makeAdr();
      adrRepo.findOne.mockResolvedValue(adr);

      await service.resolveReaction('adr-1', 'Recovered fully');

      expect(adrRepo.update).toHaveBeenCalledWith(
        'adr-1',
        expect.objectContaining({
          status: ReactionStatus.RESOLVED,
          outcome: 'Recovered fully',
        }),
      );
    });
  });

  describe('reportToFDA', () => {
    it('marks the reaction as FDA reported', async () => {
      const adr = makeAdr();
      adrRepo.findOne.mockResolvedValue(adr);

      await service.reportToFDA('adr-1', 'FDA-2025-001');

      expect(adrRepo.update).toHaveBeenCalledWith(
        'adr-1',
        expect.objectContaining({
          fdaReported: true,
          fdaReportNumber: 'FDA-2025-001',
        }),
      );
    });
  });

  describe('discontinueMedication', () => {
    it('marks the medication as discontinued', async () => {
      const adr = makeAdr();
      adrRepo.findOne.mockResolvedValue(adr);

      await service.discontinueMedication('adr-1');

      expect(adrRepo.update).toHaveBeenCalledWith(
        'adr-1',
        expect.objectContaining({ medicationDiscontinued: true }),
      );
    });
  });

  describe('getReactionStats', () => {
    it('computes correct statistics', async () => {
      const reactions = [
        makeAdr({ severity: ReactionSeverity.MILD, status: ReactionStatus.ACTIVE, medicationName: 'Drug-A' }),
        makeAdr({ severity: ReactionSeverity.SEVERE, status: ReactionStatus.RESOLVED, fdaReported: true, medicationName: 'Drug-B' }),
        makeAdr({ severity: ReactionSeverity.MODERATE, status: ReactionStatus.ACTIVE, medicationName: 'Drug-A' }),
      ];
      adrRepo.find.mockResolvedValue(reactions);

      const stats = await service.getReactionStats('2025-01-01', '2025-01-31');

      expect(stats.total).toBe(3);
      expect(stats.mild).toBe(1);
      expect(stats.severe).toBe(1);
      expect(stats.moderate).toBe(1);
      expect(stats.active).toBe(2);
      expect(stats.resolved).toBe(1);
      expect(stats.fdaReported).toBe(1);
      expect(stats.medicationBreakdown['Drug-A']).toBe(2);
      expect(stats.medicationBreakdown['Drug-B']).toBe(1);
    });
  });

  describe('getPatientAllergies', () => {
    it('returns unique medication names for active reactions', async () => {
      const reactions = [
        makeAdr({ medicationName: 'Penicillin' }),
        makeAdr({ medicationName: 'Penicillin' }),
        makeAdr({ medicationName: 'Ibuprofen' }),
      ];
      adrRepo.find.mockResolvedValue(reactions);

      const result = await service.getPatientAllergies('patient-1');
      expect(result).toEqual(['Penicillin', 'Ibuprofen']);
    });
  });

  describe('checkForDuplicateReaction', () => {
    it('returns true when a duplicate exists', async () => {
      adrRepo.findOne.mockResolvedValue(makeAdr());
      const result = await service.checkForDuplicateReaction(
        'patient-1',
        'Penicillin',
        new Date('2025-01-15T10:00:00Z'),
      );
      expect(result).toBe(true);
    });

    it('returns false when no duplicate exists', async () => {
      adrRepo.findOne.mockResolvedValue(null);
      const result = await service.checkForDuplicateReaction(
        'patient-1',
        'Penicillin',
        new Date('2025-01-15T10:00:00Z'),
      );
      expect(result).toBe(false);
    });
  });
});
