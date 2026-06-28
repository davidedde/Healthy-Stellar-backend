import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MissedDoseService } from './missed-dose.service';
import { MissedDose, MissedDoseReason, FollowUpStatus } from '../entities/missed-dose.entity';
import { MedicationAdministrationRecord } from '../entities/medication-administration-record.entity';
import { AlertService } from './alert.service';

describe('MissedDoseService', () => {
  let service: MissedDoseService;
  let missedDoseRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let alertService: {
    sendCriticalMissedDoseAlert: jest.Mock;
    sendPhysicianMissedDoseNotification: jest.Mock;
  };

  const makeMar = (overrides: Partial<MedicationAdministrationRecord> = {}) =>
    ({
      id: 'mar-1',
      patientId: 'patient-1',
      medicationName: 'Aspirin',
      scheduledTime: new Date('2025-01-15T10:00:00Z'),
      isHighAlert: false,
      ...overrides,
    }) as MedicationAdministrationRecord;

  const makeMissedDose = (overrides: Partial<MissedDose> = {}) =>
    ({
      id: 'md-1',
      marId: 'mar-1',
      patientId: 'patient-1',
      medicationName: 'Aspirin',
      scheduledTime: new Date('2025-01-15T10:00:00Z'),
      reason: MissedDoseReason.OTHER,
      followUpStatus: FollowUpStatus.PENDING,
      isCriticalMedication: false,
      alertSent: false,
      createdAt: new Date(),
      ...overrides,
    }) as MissedDose;

  beforeEach(async () => {
    missedDoseRepo = {
      create: jest.fn((dto) => ({ id: 'md-1', ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    alertService = {
      sendCriticalMissedDoseAlert: jest.fn().mockResolvedValue(undefined),
      sendPhysicianMissedDoseNotification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissedDoseService,
        { provide: getRepositoryToken(MissedDose), useValue: missedDoseRepo },
        { provide: AlertService, useValue: alertService },
      ],
    }).compile();

    service = module.get(MissedDoseService);
  });

  describe('createMissedDose', () => {
    it('creates a missed dose from MAR data', async () => {
      const mar = makeMar();
      await service.createMissedDose(mar, 'nurse-1', 'Jane Doe');

      expect(missedDoseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          marId: 'mar-1',
          patientId: 'patient-1',
          medicationName: 'Aspirin',
          nurseId: 'nurse-1',
          nurseName: 'Jane Doe',
          isCriticalMedication: false,
        }),
      );
      expect(missedDoseRepo.save).toHaveBeenCalled();
    });

    it('sends alert for high-alert medication', async () => {
      const mar = makeMar({ isHighAlert: true });
      const savedMissedDose = makeMissedDose({ isCriticalMedication: true });
      missedDoseRepo.save.mockResolvedValue(savedMissedDose);

      await service.createMissedDose(mar, 'nurse-1', 'Jane Doe');

      expect(alertService.sendCriticalMissedDoseAlert).toHaveBeenCalledWith(savedMissedDose);
      expect(missedDoseRepo.update).toHaveBeenCalledWith(
        savedMissedDose.id,
        expect.objectContaining({ alertSent: true }),
      );
    });

    it('does not send alert for non-high-alert medication', async () => {
      const mar = makeMar({ isHighAlert: false });
      await service.createMissedDose(mar, 'nurse-1', 'Jane Doe');
      expect(alertService.sendCriticalMissedDoseAlert).not.toHaveBeenCalled();
    });

    it('uses provided reason or defaults to OTHER', async () => {
      const mar = makeMar();

      await service.createMissedDose(mar, 'nurse-1', 'Jane', MissedDoseReason.PATIENT_UNAVAILABLE);

      expect(missedDoseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ reason: MissedDoseReason.PATIENT_UNAVAILABLE }),
      );
    });
  });

  describe('findPendingFollowUps', () => {
    it('queries for pending follow-ups', async () => {
      await service.findPendingFollowUps();
      expect(missedDoseRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { followUpStatus: FollowUpStatus.PENDING } }),
      );
    });
  });

  describe('findCriticalMissedDoses', () => {
    it('queries for critical pending missed doses', async () => {
      await service.findCriticalMissedDoses();
      expect(missedDoseRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isCriticalMedication: true, followUpStatus: FollowUpStatus.PENDING },
        }),
      );
    });
  });

  describe('updateFollowUpStatus', () => {
    it('throws when missed dose not found', async () => {
      missedDoseRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateFollowUpStatus('missing', FollowUpStatus.RESOLVED),
      ).rejects.toThrow('Missed dose record not found');
    });

    it('updates status to RESOLVED with resolvedBy and resolvedAt', async () => {
      const md = makeMissedDose();
      missedDoseRepo.findOne.mockResolvedValue(md);

      await service.updateFollowUpStatus('md-1', FollowUpStatus.RESOLVED, 'Fixed', 'doc-1');

      expect(missedDoseRepo.update).toHaveBeenCalledWith(
        'md-1',
        expect.objectContaining({
          followUpStatus: FollowUpStatus.RESOLVED,
          followUpNotes: 'Fixed',
          resolvedBy: 'doc-1',
        }),
      );
    });

    it('updates status without resolvedAt for non-RESOLVED status', async () => {
      const md = makeMissedDose();
      missedDoseRepo.findOne.mockResolvedValue(md);

      await service.updateFollowUpStatus('md-1', FollowUpStatus.CONTACTED_PHYSICIAN);

      expect(missedDoseRepo.update).toHaveBeenCalledWith(
        'md-1',
        expect.objectContaining({
          followUpStatus: FollowUpStatus.CONTACTED_PHYSICIAN,
        }),
      );
    });
  });

  describe('notifyPhysician', () => {
    it('throws when not found', async () => {
      missedDoseRepo.findOne.mockResolvedValue(null);
      await expect(service.notifyPhysician('missing')).rejects.toThrow('Missed dose record not found');
    });

    it('marks as physician notified and sends notification', async () => {
      const md = makeMissedDose();
      missedDoseRepo.findOne.mockResolvedValue(md);

      await service.notifyPhysician('md-1');

      expect(missedDoseRepo.update).toHaveBeenCalledWith(
        'md-1',
        expect.objectContaining({
          physicianNotified: true,
          followUpStatus: FollowUpStatus.CONTACTED_PHYSICIAN,
        }),
      );
      expect(alertService.sendPhysicianMissedDoseNotification).toHaveBeenCalledWith(md);
    });
  });

  describe('rescheduleMedication', () => {
    it('throws when not found', async () => {
      missedDoseRepo.findOne.mockResolvedValue(null);
      await expect(service.rescheduleMedication('missing', new Date())).rejects.toThrow(
        'Missed dose record not found',
      );
    });

    it('sets rescheduled time and updates status', async () => {
      const md = makeMissedDose();
      missedDoseRepo.findOne.mockResolvedValue(md);
      const newTime = new Date('2025-01-15T14:00:00Z');

      await service.rescheduleMedication('md-1', newTime);

      expect(missedDoseRepo.update).toHaveBeenCalledWith(
        'md-1',
        expect.objectContaining({
          rescheduledTime: newTime,
          followUpStatus: FollowUpStatus.RESCHEDULED,
        }),
      );
    });
  });

  describe('getMissedDoseStats', () => {
    it('computes correct statistics', async () => {
      const missedDoses = [
        makeMissedDose({ isCriticalMedication: true, followUpStatus: FollowUpStatus.PENDING, reason: MissedDoseReason.PATIENT_REFUSED }),
        makeMissedDose({ isCriticalMedication: false, followUpStatus: FollowUpStatus.RESOLVED, reason: MissedDoseReason.OTHER }),
        makeMissedDose({ isCriticalMedication: false, followUpStatus: FollowUpStatus.PENDING, reason: MissedDoseReason.PATIENT_REFUSED }),
      ];
      missedDoseRepo.find.mockResolvedValue(missedDoses);

      const stats = await service.getMissedDoseStats('patient-1', '2025-01-01', '2025-01-31');

      expect(stats.total).toBe(3);
      expect(stats.critical).toBe(1);
      expect(stats.pending).toBe(2);
      expect(stats.resolved).toBe(1);
      expect(stats.reasonBreakdown[MissedDoseReason.PATIENT_REFUSED]).toBe(2);
      expect(stats.reasonBreakdown[MissedDoseReason.OTHER]).toBe(1);
    });
  });

  describe('getOverdueMissedDoses', () => {
    it('queries for overdue missed doses', async () => {
      await service.getOverdueMissedDoses(24);
      expect(missedDoseRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            followUpStatus: FollowUpStatus.PENDING,
          }),
          order: { createdAt: 'ASC' },
        }),
      );
    });
  });
});
