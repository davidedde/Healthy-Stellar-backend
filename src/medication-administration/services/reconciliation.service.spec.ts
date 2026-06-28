import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import {
  MedicationReconciliation,
  ReconciliationStatus,
  ReconciliationType,
} from '../entities/medication-reconciliation.entity';
import { AlertService } from './alert.service';

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let reconciliationRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let alertService: {
    sendReconciliationAlert: jest.Mock;
    sendDrugInteractionAlert: jest.Mock;
  };

  const makeReconciliation = (overrides: Partial<MedicationReconciliation> = {}) =>
    ({
      id: 'rec-1',
      patientId: 'patient-1',
      reconciliationType: ReconciliationType.ADMISSION,
      status: ReconciliationStatus.PENDING,
      homeMedications: null,
      currentMedications: null,
      discrepanciesFound: null,
      createdAt: new Date('2025-01-15'),
      ...overrides,
    }) as MedicationReconciliation;

  beforeEach(async () => {
    reconciliationRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    alertService = {
      sendReconciliationAlert: jest.fn().mockResolvedValue(undefined),
      sendDrugInteractionAlert: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: getRepositoryToken(MedicationReconciliation), useValue: reconciliationRepo },
        { provide: AlertService, useValue: alertService },
      ],
    }).compile();

    service = module.get(ReconciliationService);
  });

  describe('create', () => {
    it('creates and saves a reconciliation', async () => {
      const dto = { patientId: 'patient-1', reconciliationType: ReconciliationType.ADMISSION } as any;
      await service.create(dto);
      expect(reconciliationRepo.create).toHaveBeenCalledWith(dto);
      expect(reconciliationRepo.save).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the record when found', async () => {
      const rec = makeReconciliation();
      reconciliationRepo.findOne.mockResolvedValue(rec);
      const result = await service.findOne('rec-1');
      expect(result).toEqual(rec);
    });

    it('throws NotFoundException when not found', async () => {
      reconciliationRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findPending', () => {
    it('queries for pending reconciliations', async () => {
      await service.findPending();
      expect(reconciliationRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: ReconciliationStatus.PENDING } }),
      );
    });
  });

  describe('updateStatus', () => {
    it('updates status and sets completedAt for COMPLETED', async () => {
      const rec = makeReconciliation();
      reconciliationRepo.findOne.mockResolvedValue(rec);

      await service.updateStatus('rec-1', ReconciliationStatus.COMPLETED);

      expect(reconciliationRepo.update).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({ status: ReconciliationStatus.COMPLETED }),
      );
    });
  });

  describe('performReconciliation', () => {
    it('throws when home medications are missing', async () => {
      const rec = makeReconciliation({ homeMedications: null, currentMedications: [{ name: 'A', dosage: '10mg', frequency: 'daily' }] });
      reconciliationRepo.findOne.mockResolvedValue(rec);

      await expect(
        service.performReconciliation('rec-1', 'pharm-1', 'Jane'),
      ).rejects.toThrow('Both home and current medications must be provided');
    });

    it('detects discrepancies and sends alert', async () => {
      const rec = makeReconciliation({
        homeMedications: [
          { name: 'Aspirin', dosage: '100mg', frequency: 'daily' },
          { name: 'Metformin', dosage: '500mg', frequency: 'twice daily' },
        ],
        currentMedications: [
          { name: 'Aspirin', dosage: '200mg', frequency: 'daily' },
        ],
      });
      reconciliationRepo.findOne.mockResolvedValue(rec);

      await service.performReconciliation('rec-1', 'pharm-1', 'Jane');

      expect(reconciliationRepo.update).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({
          pharmacistId: 'pharm-1',
          pharmacistName: 'Jane',
          status: ReconciliationStatus.REQUIRES_REVIEW,
        }),
      );
      expect(alertService.sendReconciliationAlert).toHaveBeenCalledWith('patient-1', expect.any(Number));
    });

    it('marks as COMPLETED when no discrepancies found', async () => {
      const rec = makeReconciliation({
        homeMedications: [{ name: 'Aspirin', dosage: '100mg', frequency: 'daily' }],
        currentMedications: [{ name: 'Aspirin', dosage: '100mg', frequency: 'daily' }],
      });
      reconciliationRepo.findOne.mockResolvedValue(rec);

      await service.performReconciliation('rec-1', 'pharm-1', 'Jane');

      expect(reconciliationRepo.update).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({ status: ReconciliationStatus.COMPLETED }),
      );
      expect(alertService.sendReconciliationAlert).not.toHaveBeenCalled();
    });
  });

  describe('checkDrugInteractions', () => {
    it('sends alert when interactions are found', async () => {
      const rec = makeReconciliation();
      reconciliationRepo.findOne.mockResolvedValue(rec);

      const interactions = [{ drug1: 'A', drug2: 'B', severity: 'high' }];
      await service.checkDrugInteractions('rec-1', interactions);

      expect(alertService.sendDrugInteractionAlert).toHaveBeenCalledWith('patient-1', interactions);
    });

    it('does not send alert when no interactions', async () => {
      const rec = makeReconciliation();
      reconciliationRepo.findOne.mockResolvedValue(rec);

      await service.checkDrugInteractions('rec-1');

      expect(alertService.sendDrugInteractionAlert).not.toHaveBeenCalled();
    });
  });

  describe('getReconciliationStats', () => {
    it('computes correct statistics', async () => {
      const reconciliations = [
        makeReconciliation({ status: ReconciliationStatus.COMPLETED, reconciliationType: ReconciliationType.ADMISSION, discrepanciesFound: [{ type: 'A' }] }),
        makeReconciliation({ status: ReconciliationStatus.PENDING, reconciliationType: ReconciliationType.ADMISSION, discrepanciesFound: null }),
        makeReconciliation({ status: ReconciliationStatus.COMPLETED, reconciliationType: ReconciliationType.DISCHARGE, discrepanciesFound: [{ type: 'B' }, { type: 'C' }] }),
      ];
      reconciliationRepo.find.mockResolvedValue(reconciliations);

      const stats = await service.getReconciliationStats('2025-01-01', '2025-01-31');

      expect(stats.total).toBe(3);
      expect(stats.completed).toBe(2);
      expect(stats.pending).toBe(1);
      expect(stats.withDiscrepancies).toBe(2);
      expect(stats.averageDiscrepancies).toBe(1);
    });
  });
});
