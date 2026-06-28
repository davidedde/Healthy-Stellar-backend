import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { MarService } from './mar.service';
import {
  MedicationAdministrationRecord,
  AdministrationStatus,
} from '../entities/medication-administration-record.entity';
import { MissedDoseService } from './missed-dose.service';
import { AlertService } from './alert.service';

describe('MarService', () => {
  let service: MarService;
  let marRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    remove: jest.Mock;
    update: jest.Mock;
  };
  let missedDoseService: { createMissedDose: jest.Mock };
  let alertService: { sendHighAlertRefusalAlert: jest.Mock };

  const makeMar = (overrides: Partial<MedicationAdministrationRecord> = {}) =>
    ({
      id: 'mar-1',
      patientId: 'patient-1',
      medicationName: 'Aspirin',
      status: AdministrationStatus.SCHEDULED,
      scheduledTime: new Date('2025-01-15T10:00:00Z'),
      isHighAlert: false,
      requiresWitness: false,
      ...overrides,
    }) as MedicationAdministrationRecord;

  beforeEach(async () => {
    marRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      remove: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    missedDoseService = { createMissedDose: jest.fn().mockResolvedValue({}) };
    alertService = { sendHighAlertRefusalAlert: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarService,
        { provide: getRepositoryToken(MedicationAdministrationRecord), useValue: marRepo },
        { provide: MissedDoseService, useValue: missedDoseService },
        { provide: AlertService, useValue: alertService },
      ],
    }).compile();

    service = module.get(MarService);
  });

  describe('create', () => {
    it('creates a MAR with parsed dates', async () => {
      const dto = {
        patientId: 'patient-1',
        medicationName: 'Aspirin',
        scheduledTime: '2025-01-15T10:00:00Z',
        expirationDate: '2025-06-01',
      } as any;

      await service.create(dto);

      expect(marRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'patient-1',
          administrationDate: '2025-01-15',
        }),
      );
      expect(marRepo.save).toHaveBeenCalled();
    });

    it('sets expirationDate to null when not provided', async () => {
      const dto = { scheduledTime: '2025-01-15T10:00:00Z' } as any;
      await service.create(dto);
      expect(marRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ expirationDate: null }),
      );
    });
  });

  describe('findAll', () => {
    it('returns records ordered by scheduledTime ASC', async () => {
      const records = [makeMar()];
      marRepo.find.mockResolvedValue(records);
      const result = await service.findAll();
      expect(result).toEqual(records);
      expect(marRepo.find).toHaveBeenCalledWith({ order: { scheduledTime: 'ASC' } });
    });
  });

  describe('findByPatient', () => {
    it('filters by patientId', async () => {
      await service.findByPatient('patient-1');
      expect(marRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { patientId: 'patient-1' } }),
      );
    });
  });

  describe('findByPatientAndDate', () => {
    it('filters by patientId and date', async () => {
      await service.findByPatientAndDate('patient-1', '2025-01-15');
      expect(marRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { patientId: 'patient-1', administrationDate: '2025-01-15' },
        }),
      );
    });
  });

  describe('findByNurse', () => {
    it('filters by nurseId ordered DESC', async () => {
      await service.findByNurse('nurse-1');
      expect(marRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { nurseId: 'nurse-1' },
          order: { scheduledTime: 'DESC' },
        }),
      );
    });
  });

  describe('findScheduledMedications', () => {
    it('returns scheduled medications for a given date', async () => {
      await service.findScheduledMedications('2025-01-15');
      expect(marRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: AdministrationStatus.SCHEDULED, administrationDate: '2025-01-15' },
        }),
      );
    });

    it('returns all scheduled medications when no date provided', async () => {
      await service.findScheduledMedications();
      expect(marRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: AdministrationStatus.SCHEDULED },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the record when found', async () => {
      const mar = makeMar();
      marRepo.findOne.mockResolvedValue(mar);
      const result = await service.findOne('mar-1');
      expect(result).toEqual(mar);
    });

    it('throws NotFoundException when not found', async () => {
      marRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('administerMedication', () => {
    it('throws NotFoundException when MAR not found', async () => {
      marRepo.findOne.mockResolvedValue(null);
      await expect(
        service.administerMedication({ marId: 'missing' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when MAR already processed', async () => {
      const mar = makeMar({ status: AdministrationStatus.ADMINISTERED });
      marRepo.findOne.mockResolvedValue(mar);
      await expect(
        service.administerMedication({ marId: 'mar-1' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when high-alert verifications are incomplete', async () => {
      const mar = makeMar({ isHighAlert: true });
      marRepo.findOne.mockResolvedValue(mar);
      await expect(
        service.administerMedication({
          marId: 'mar-1',
          barcodeVerified: true,
          patientVerified: false,
          medicationVerified: true,
          doseVerified: true,
          routeVerified: true,
          timeVerified: true,
          administrationTime: '2025-01-15T10:05:00Z',
        } as any),
      ).rejects.toThrow('All verifications required for high-alert medication');
    });

    it('throws BadRequestException when high-alert requires witness but none provided', async () => {
      const mar = makeMar({ isHighAlert: true, requiresWitness: true });
      marRepo.findOne.mockResolvedValue(mar);
      await expect(
        service.administerMedication({
          marId: 'mar-1',
          barcodeVerified: true,
          patientVerified: true,
          medicationVerified: true,
          doseVerified: true,
          routeVerified: true,
          timeVerified: true,
          administrationTime: '2025-01-15T10:05:00Z',
        } as any),
      ).rejects.toThrow('Witness required for this medication');
    });

    it('administers medication and saves updated record', async () => {
      const mar = makeMar();
      marRepo.findOne.mockResolvedValue(mar);
      marRepo.save.mockResolvedValue(mar);

      const dto = {
        marId: 'mar-1',
        status: AdministrationStatus.ADMINISTERED,
        nurseId: 'nurse-1',
        nurseName: 'Jane Doe',
        administrationTime: '2025-01-15T10:05:00Z',
      } as any;

      await service.administerMedication(dto);
      expect(marRepo.save).toHaveBeenCalled();
    });

    it('creates missed dose record when status is MISSED', async () => {
      const mar = makeMar();
      marRepo.findOne.mockResolvedValue(mar);
      marRepo.save.mockResolvedValue(mar);

      const dto = {
        marId: 'mar-1',
        status: AdministrationStatus.MISSED,
        nurseId: 'nurse-1',
        nurseName: 'Jane Doe',
        administrationTime: '2025-01-15T10:05:00Z',
      } as any;

      await service.administerMedication(dto);
      expect(missedDoseService.createMissedDose).toHaveBeenCalledWith(mar, 'nurse-1', 'Jane Doe');
    });

    it('sends alert when high-alert medication is refused', async () => {
      const mar = makeMar({ isHighAlert: true });
      marRepo.findOne.mockResolvedValue(mar);
      marRepo.save.mockResolvedValue(mar);

      const dto = {
        marId: 'mar-1',
        status: AdministrationStatus.REFUSED,
        barcodeVerified: true,
        patientVerified: true,
        medicationVerified: true,
        doseVerified: true,
        routeVerified: true,
        timeVerified: true,
        administrationTime: '2025-01-15T10:05:00Z',
      } as any;

      await service.administerMedication(dto);
      expect(alertService.sendHighAlertRefusalAlert).toHaveBeenCalledWith(mar);
    });
  });

  describe('getAdministrationStats', () => {
    it('computes correct stats from records', async () => {
      const records = [
        makeMar({ status: AdministrationStatus.ADMINISTERED }),
        makeMar({ status: AdministrationStatus.ADMINISTERED }),
        makeMar({ status: AdministrationStatus.MISSED }),
        makeMar({ status: AdministrationStatus.REFUSED }),
        makeMar({ status: AdministrationStatus.HELD }),
      ];
      marRepo.find.mockResolvedValue(records);

      const stats = await service.getAdministrationStats('patient-1', '2025-01-01', '2025-01-31');

      expect(stats.total).toBe(5);
      expect(stats.administered).toBe(2);
      expect(stats.missed).toBe(1);
      expect(stats.refused).toBe(1);
      expect(stats.held).toBe(1);
      expect(stats.adherenceRate).toBe(40);
    });

    it('returns 0 adherence rate when no records', async () => {
      marRepo.find.mockResolvedValue([]);
      const stats = await service.getAdministrationStats('patient-1', '2025-01-01', '2025-01-31');
      expect(stats.adherenceRate).toBe(0);
    });
  });

  describe('update', () => {
    it('updates and returns the record', async () => {
      const mar = makeMar();
      marRepo.findOne.mockResolvedValue(mar);
      marRepo.save.mockResolvedValue({ ...mar, administrationNotes: 'updated' });

      const result = await service.update('mar-1', { administrationNotes: 'updated' } as any);
      expect(marRepo.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes the record', async () => {
      const mar = makeMar();
      marRepo.findOne.mockResolvedValue(mar);
      await service.remove('mar-1');
      expect(marRepo.remove).toHaveBeenCalledWith(mar);
    });
  });
});
