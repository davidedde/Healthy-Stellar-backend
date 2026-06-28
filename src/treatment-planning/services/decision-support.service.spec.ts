import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DecisionSupportService } from './decision-support.service';
import { ClinicalGuideline } from '../entities/clinical-guideline.entity';
import { DecisionSupportAlert } from '../entities/decision-support-alert.entity';

// Mock the enums module because the stale index.js in common/enums is missing some exports
jest.mock('../../common/enums', () => ({
  AlertType: {
    DRUG_INTERACTION: 'drug_interaction',
    GUIDELINE_RECOMMENDATION: 'guideline_recommendation',
    CONTRAINDICATION: 'contraindication',
    DUPLICATE_THERAPY: 'duplicate_therapy',
  },
  AlertSeverity: {
    INFO: 'info',
    WARNING: 'warning',
    CRITICAL: 'critical',
  },
  TreatmentPlanStatus: {
    DRAFT: 'draft',
    ACTIVE: 'active',
    ON_HOLD: 'on_hold',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
  },
  ProcedureStatus: {
    SCHEDULED: 'scheduled',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    RESCHEDULED: 'rescheduled',
  },
}));

const AlertType = {
  DRUG_INTERACTION: 'drug_interaction' as const,
  GUIDELINE_RECOMMENDATION: 'guideline_recommendation' as const,
  CONTRAINDICATION: 'contraindication' as const,
  DUPLICATE_THERAPY: 'duplicate_therapy' as const,
};

const AlertSeverity = {
  INFO: 'info' as const,
  WARNING: 'warning' as const,
  CRITICAL: 'critical' as const,
};

describe('DecisionSupportService', () => {
  let service: DecisionSupportService;
  let guidelineRepo: {
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let alertRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  const queryBuilderMock = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    guidelineRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilderMock),
    };
    alertRepo = {
      create: jest.fn((dto) => ({ id: 'alert-1', ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilderMock),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecisionSupportService,
        { provide: getRepositoryToken(ClinicalGuideline), useValue: guidelineRepo },
        { provide: getRepositoryToken(DecisionSupportAlert), useValue: alertRepo },
      ],
    }).compile();

    service = module.get(DecisionSupportService);
  });

  describe('createAlert', () => {
    it('creates and saves an alert', async () => {
      const result = await service.createAlert(
        AlertType.DRUG_INTERACTION,
        AlertSeverity.WARNING,
        'Drug Interaction Warning',
        'Drug A interacts with Drug B',
        { patientId: 'patient-1' },
      );

      expect(alertRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: AlertType.DRUG_INTERACTION,
          severity: AlertSeverity.WARNING,
          title: 'Drug Interaction Warning',
          message: 'Drug A interacts with Drug B',
          patientId: 'patient-1',
        }),
      );
      expect(alertRepo.save).toHaveBeenCalled();
    });

    it('creates alert without optional fields', async () => {
      await service.createAlert(
        AlertType.CONTRAINDICATION,
        AlertSeverity.CRITICAL,
        'Contraindication',
        'Do not prescribe',
      );

      expect(alertRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: AlertType.CONTRAINDICATION,
          severity: AlertSeverity.CRITICAL,
        }),
      );
    });
  });

  describe('getPatientAlerts', () => {
    it('queries non-dismissed, non-acknowledged alerts by default', async () => {
      await service.getPatientAlerts('patient-1');

      expect(alertRepo.createQueryBuilder).toHaveBeenCalledWith('alert');
      expect(queryBuilderMock.where).toHaveBeenCalledWith(
        'alert.patientId = :patientId',
        { patientId: 'patient-1' },
      );
      expect(queryBuilderMock.andWhere).toHaveBeenCalledWith(
        'alert.dismissed = :dismissed',
        { dismissed: false },
      );
      expect(queryBuilderMock.andWhere).toHaveBeenCalledWith(
        'alert.acknowledged = :acknowledged',
        { acknowledged: false },
      );
    });

    it('includes acknowledged alerts when requested', async () => {
      await service.getPatientAlerts('patient-1', true);

      expect(queryBuilderMock.andWhere).not.toHaveBeenCalledWith(
        'alert.acknowledged = :acknowledged',
        expect.anything(),
      );
    });
  });

  describe('acknowledgeAlert', () => {
    it('throws when alert not found', async () => {
      alertRepo.findOne.mockResolvedValue(null);
      await expect(service.acknowledgeAlert('missing', 'doc-1')).rejects.toThrow('Alert not found');
    });

    it('marks alert as acknowledged', async () => {
      const alert = {
        id: 'alert-1',
        acknowledged: false,
        acknowledgedBy: null,
        acknowledgedAt: null,
        acknowledgedNotes: null,
      } as DecisionSupportAlert;
      alertRepo.findOne.mockResolvedValue(alert);
      alertRepo.save.mockResolvedValue(alert);

      await service.acknowledgeAlert('alert-1', 'doc-1', 'Noted');

      expect(alert.acknowledged).toBe(true);
      expect(alert.acknowledgedBy).toBe('doc-1');
      expect(alert.acknowledgedNotes).toBe('Noted');
      expect(alert.acknowledgedAt).toBeDefined();
    });
  });

  describe('dismissAlert', () => {
    it('throws when alert not found', async () => {
      alertRepo.findOne.mockResolvedValue(null);
      await expect(service.dismissAlert('missing')).rejects.toThrow('Alert not found');
    });

    it('marks alert as dismissed with reason', async () => {
      const alert = {
        id: 'alert-1',
        dismissed: false,
        dismissalReason: null,
      } as DecisionSupportAlert;
      alertRepo.findOne.mockResolvedValue(alert);
      alertRepo.save.mockResolvedValue(alert);

      await service.dismissAlert('alert-1', 'Not applicable');

      expect(alert.dismissed).toBe(true);
      expect(alert.dismissalReason).toBe('Not applicable');
    });
  });

  describe('evaluateTreatmentPlan', () => {
    it('returns empty alerts when no guidelines found', async () => {
      guidelineRepo.find.mockResolvedValue([]);
      const result = await service.evaluateTreatmentPlan('plan-1', ['diag-1']);
      expect(result).toEqual([]);
    });

    it('creates alerts for guidelines with recommendations', async () => {
      guidelineRepo.find.mockResolvedValue([
        {
          id: 'guide-1',
          name: 'Diabetes Care',
          source: 'ADA 2025',
          overallEvidenceLevel: 'A',
          recommendedInterventions: [
            { intervention: 'Monitor HbA1c' },
            { intervention: 'Foot exam' },
          ],
        },
      ]);

      const result = await service.evaluateTreatmentPlan('plan-1', ['diag-1']);

      expect(alertRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: AlertType.GUIDELINE_RECOMMENDATION,
          severity: AlertSeverity.INFO,
          treatmentPlanId: 'plan-1',
          diagnosisId: 'diag-1',
        }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('findGuidelinesByDiagnosisCode', () => {
    it('queries active guidelines by ICD-10 code', async () => {
      await service.findGuidelinesByDiagnosisCode('E11.9');

      expect(guidelineRepo.createQueryBuilder).toHaveBeenCalledWith('guideline');
      expect(queryBuilderMock.where).toHaveBeenCalledWith(
        ':code = ANY(guideline.icd10Codes)',
        { code: 'E11.9' },
      );
    });
  });
});
