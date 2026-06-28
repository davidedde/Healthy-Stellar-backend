import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { BarcodeService } from './barcode.service';
import {
  BarcodeVerification,
  VerificationType,
  VerificationStatus,
} from '../entities/barcode-verification.entity';
import { MedicationAdministrationRecord } from '../entities/medication-administration-record.entity';

describe('BarcodeService', () => {
  let service: BarcodeService;
  let barcodeRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let marRepo: {
    findOne: jest.Mock;
    update: jest.Mock;
  };

  const makeMar = (overrides: Partial<MedicationAdministrationRecord> = {}) =>
    ({
      id: 'mar-1',
      patientId: 'patient-1',
      medicationBarcode: 'MED-BARCODE-123',
      scheduledTime: new Date(),
      patientVerified: false,
      medicationVerified: false,
      doseVerified: false,
      routeVerified: false,
      timeVerified: false,
      barcodeVerified: false,
      ...overrides,
    }) as MedicationAdministrationRecord;

  beforeEach(async () => {
    barcodeRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((entity) => Promise.resolve({ id: 'ver-1', ...entity })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    marRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BarcodeService,
        { provide: getRepositoryToken(BarcodeVerification), useValue: barcodeRepo },
        { provide: getRepositoryToken(MedicationAdministrationRecord), useValue: marRepo },
      ],
    }).compile();

    service = module.get(BarcodeService);
  });

  describe('scanBarcode', () => {
    it('throws BadRequestException when MAR not found', async () => {
      marRepo.findOne.mockResolvedValue(null);
      await expect(
        service.scanBarcode({ marId: 'missing', verificationType: VerificationType.PATIENT_WRISTBAND } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns SUCCESS for matching patient wristband scan', async () => {
      const mar = makeMar();
      marRepo.findOne.mockResolvedValue(mar);

      const dto = {
        marId: 'mar-1',
        verificationType: VerificationType.PATIENT_WRISTBAND,
        scannedBarcode: 'PATIENT-123',
        expectedBarcode: 'PATIENT-123',
      } as any;

      await service.scanBarcode(dto);

      expect(barcodeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: VerificationStatus.SUCCESS }),
      );
      expect(barcodeRepo.save).toHaveBeenCalled();
    });

    it('returns FAILED for mismatched patient wristband scan', async () => {
      const mar = makeMar();
      marRepo.findOne.mockResolvedValue(mar);

      const dto = {
        marId: 'mar-1',
        verificationType: VerificationType.PATIENT_WRISTBAND,
        scannedBarcode: 'WRONG-123',
        expectedBarcode: 'PATIENT-123',
      } as any;

      await service.scanBarcode(dto);

      expect(barcodeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: VerificationStatus.FAILED }),
      );
    });

    it('returns SUCCESS for matching medication barcode', async () => {
      const mar = makeMar({ medicationBarcode: 'MED-BARCODE-123' });
      marRepo.findOne.mockResolvedValue(mar);

      const dto = {
        marId: 'mar-1',
        verificationType: VerificationType.MEDICATION_BARCODE,
        scannedBarcode: 'MED-BARCODE-123',
      } as any;

      await service.scanBarcode(dto);

      expect(barcodeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: VerificationStatus.SUCCESS }),
      );
    });

    it('returns FAILED for mismatched medication barcode', async () => {
      const mar = makeMar({ medicationBarcode: 'MED-BARCODE-123' });
      marRepo.findOne.mockResolvedValue(mar);

      const dto = {
        marId: 'mar-1',
        verificationType: VerificationType.MEDICATION_BARCODE,
        scannedBarcode: 'WRONG-BARCODE',
      } as any;

      await service.scanBarcode(dto);

      expect(barcodeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: VerificationStatus.FAILED }),
      );
    });

    it('updates MAR verification status after scan', async () => {
      const mar = makeMar();
      marRepo.findOne.mockResolvedValue(mar);

      const dto = {
        marId: 'mar-1',
        verificationType: VerificationType.PATIENT_WRISTBAND,
        scannedBarcode: 'PATIENT-123',
        expectedBarcode: 'PATIENT-123',
      } as any;

      await service.scanBarcode(dto);

      expect(marRepo.update).toHaveBeenCalledWith(
        'mar-1',
        expect.objectContaining({ barcodeVerified: true }),
      );
    });
  });

  describe('overrideVerification', () => {
    it('throws BadRequestException when verification not found', async () => {
      barcodeRepo.findOne.mockResolvedValue(null);
      await expect(
        service.overrideVerification('missing', 'reason', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets override status and reason', async () => {
      const verification = {
        id: 'ver-1',
        status: VerificationStatus.FAILED,
      } as BarcodeVerification;
      barcodeRepo.findOne.mockResolvedValue(verification);
      barcodeRepo.save.mockResolvedValue(verification);

      await service.overrideVerification('ver-1', 'Emergency override', 'admin-1');

      expect(verification.status).toBe(VerificationStatus.OVERRIDE);
      expect(verification.overrideReason).toBe('Emergency override');
      expect(verification.overrideAuthorizedBy).toBe('admin-1');
      expect(barcodeRepo.save).toHaveBeenCalled();
    });
  });

  describe('validateFiveRights', () => {
    it('throws BadRequestException when MAR not found', async () => {
      barcodeRepo.find.mockResolvedValue([]);
      marRepo.findOne.mockResolvedValue(null);
      await expect(service.validateFiveRights('missing')).rejects.toThrow(BadRequestException);
    });

    it('returns all false when no verifications done', async () => {
      const mar = makeMar();
      barcodeRepo.find.mockResolvedValue([]);
      marRepo.findOne.mockResolvedValue(mar);

      const result = await service.validateFiveRights('mar-1');

      expect(result.rightPatient).toBe(false);
      expect(result.rightMedication).toBe(false);
      expect(result.rightDose).toBe(false);
      expect(result.rightRoute).toBe(false);
      expect(result.rightTime).toBe(false);
      expect(result.allVerified).toBe(false);
    });

    it('returns allVerified true when all five rights are verified', async () => {
      const mar = makeMar({
        patientVerified: true,
        medicationVerified: true,
        doseVerified: true,
        routeVerified: true,
        timeVerified: true,
      });
      barcodeRepo.find.mockResolvedValue([]);
      marRepo.findOne.mockResolvedValue(mar);

      const result = await service.validateFiveRights('mar-1');

      expect(result.allVerified).toBe(true);
    });
  });

  describe('getVerificationHistory', () => {
    it('returns verifications ordered by time DESC', async () => {
      const verifications = [{ id: 'v1' }, { id: 'v2' }] as BarcodeVerification[];
      barcodeRepo.find.mockResolvedValue(verifications);

      const result = await service.getVerificationHistory('mar-1');

      expect(result).toEqual(verifications);
      expect(barcodeRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { marId: 'mar-1' },
          order: { verificationTime: 'DESC' },
        }),
      );
    });
  });
});
