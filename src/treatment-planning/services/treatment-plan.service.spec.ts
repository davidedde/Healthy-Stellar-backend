import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';

// Mock the stale common/enums/index.js that is missing several enum exports
jest.mock('../../common/enums', () => ({
  ClaimStatus: { DRAFT: 'draft', PENDING: 'pending', SUBMITTED: 'submitted', ACCEPTED: 'accepted', REJECTED: 'rejected', PAID: 'paid', PARTIALLY_PAID: 'partially_paid', DENIED: 'denied', APPEALED: 'appealed', VOID: 'void' },
  ClaimType: { PROFESSIONAL: '837P', INSTITUTIONAL: '837I', DENTAL: '837D' },
  InsuranceType: { PRIMARY: 'primary', SECONDARY: 'secondary', TERTIARY: 'tertiary' },
  PayerType: { COMMERCIAL: 'commercial', MEDICARE: 'medicare', MEDICAID: 'medicaid', SELF_PAY: 'self_pay', WORKERS_COMP: 'workers_comp', OTHER: 'other' },
  VerificationStatus: { PENDING: 'pending', VERIFIED: 'verified', FAILED: 'failed', EXPIRED: 'expired' },
  AuthorizationStatus: { PENDING: 'pending', APPROVED: 'approved', DENIED: 'denied', EXPIRED: 'expired', CANCELLED: 'cancelled' },
  PaymentStatus: { PENDING: 'pending', PROCESSED: 'processed', FAILED: 'failed', REFUNDED: 'refunded' },
  PaymentMethod: { CHECK: 'check', EFT: 'eft', CREDIT_CARD: 'credit_card', CASH: 'cash' },
  DenialReason: { MEDICAL_NECESSITY: 'medical_necessity', NOT_COVERED: 'not_covered', DUPLICATE: 'duplicate', EXPIRED_AUTH: 'expired_auth', MISSING_INFO: 'missing_info', OTHER: 'other' },
  AppealStatus: { PENDING: 'pending', IN_REVIEW: 'in_review', APPROVED: 'approved', DENIED: 'denied', WITHDRAWN: 'withdrawn' },
  CodeType: { ICD10: 'ICD-10', CPT: 'CPT', HCPCS: 'HCPCS', NDC: 'NDC' },
  DiagnosisStatus: { PRELIMINARY: 'preliminary', CONFIRMED: 'confirmed', RULED_OUT: 'ruled_out', DIFFERENTIAL: 'differential' },
  DiagnosisSeverity: { MILD: 'mild', MODERATE: 'moderate', SEVERE: 'severe', CRITICAL: 'critical' },
  TreatmentPlanStatus: { DRAFT: 'draft', ACTIVE: 'active', ON_HOLD: 'on_hold', COMPLETED: 'completed', CANCELLED: 'cancelled' },
  ProcedureStatus: { SCHEDULED: 'scheduled', IN_PROGRESS: 'in_progress', COMPLETED: 'completed', CANCELLED: 'cancelled', RESCHEDULED: 'rescheduled' },
  AlertSeverity: { INFO: 'info', WARNING: 'warning', CRITICAL: 'critical' },
  AlertType: { DRUG_INTERACTION: 'drug_interaction', GUIDELINE_RECOMMENDATION: 'guideline_recommendation', CONTRAINDICATION: 'contraindication', DUPLICATE_THERAPY: 'duplicate_therapy' },
}));

// Mock stale billing entity JS file that breaks the import chain
jest.mock('../../billing/entities/medical-code.entity', () => {
  class MedicalCode {}
  return { MedicalCode };
});

import { TreatmentPlanService } from './treatment-plan.service';
import { TreatmentPlan } from '../entities/treatment-plan.entity';
import { TreatmentPlanVersion } from '../entities/treatment-plan-version.entity';
import { Diagnosis } from '../../diagnosis/entities/diagnosis.entity';
import { DecisionSupportService } from './decision-support.service';

const TreatmentPlanStatus = {
  DRAFT: 'draft' as const,
  ACTIVE: 'active' as const,
  ON_HOLD: 'on_hold' as const,
  COMPLETED: 'completed' as const,
  CANCELLED: 'cancelled' as const,
};

describe('TreatmentPlanService', () => {
  let service: TreatmentPlanService;
  let planRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let versionRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let diagnosisRepo: {
    find: jest.Mock;
  };
  let decisionSupportService: {
    evaluateTreatmentPlan: jest.Mock;
  };

  const queryBuilderMock = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };

  const makePlan = (overrides: Partial<TreatmentPlan> = {}) =>
    ({
      id: 'plan-1',
      patientId: 'patient-1',
      title: 'Test Plan',
      description: 'Test Description',
      status: TreatmentPlanStatus.DRAFT,
      version: 1,
      diagnosisIds: [],
      goals: [],
      objectives: [],
      interventions: [],
      medications: [],
      procedures: [],
      outcomes: [],
      versions: [],
      reviewSchedule: null,
      specialInstructions: null,
      patientEducation: null,
      createdAt: new Date('2025-01-15'),
      ...overrides,
    }) as TreatmentPlan;

  beforeEach(async () => {
    planRepo = {
      create: jest.fn((dto) => ({ ...dto, version: 1 })),
      save: jest.fn((entity) => Promise.resolve({ id: 'plan-1', ...entity })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      remove: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilderMock),
    };
    versionRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      find: jest.fn().mockResolvedValue([]),
    };
    diagnosisRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    decisionSupportService = {
      evaluateTreatmentPlan: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TreatmentPlanService,
        { provide: getRepositoryToken(TreatmentPlan), useValue: planRepo },
        { provide: getRepositoryToken(TreatmentPlanVersion), useValue: versionRepo },
        { provide: getRepositoryToken(Diagnosis), useValue: diagnosisRepo },
        { provide: DecisionSupportService, useValue: decisionSupportService },
      ],
    }).compile();

    service = module.get(TreatmentPlanService);
  });

  describe('create', () => {
    it('creates a plan with initial version', async () => {
      const dto = {
        patientId: 'patient-1',
        title: 'Plan A',
        createdBy: 'doc-1',
      } as any;

      planRepo.save.mockResolvedValue(makePlan({ id: 'plan-1' }));
      await service.create(dto);

      expect(planRepo.create).toHaveBeenCalledWith(dto);
      expect(planRepo.save).toHaveBeenCalled();
      expect(versionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ changeNotes: 'Initial plan created' }),
      );
      expect(versionRepo.save).toHaveBeenCalled();
    });

    it('validates diagnosis IDs when provided', async () => {
      const dto = {
        patientId: 'patient-1',
        title: 'Plan B',
        diagnosisIds: ['diag-1', 'diag-2'],
        createdBy: 'doc-1',
      } as any;

      diagnosisRepo.find.mockResolvedValue([{ id: 'diag-1' }]);

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('evaluates decision support when diagnosis IDs are present', async () => {
      const dto = {
        patientId: 'patient-1',
        title: 'Plan C',
        diagnosisIds: ['diag-1'],
        createdBy: 'doc-1',
      } as any;

      diagnosisRepo.find.mockResolvedValue([{ id: 'diag-1' }]);
      const savedPlan = makePlan({ id: 'plan-1', diagnosisIds: ['diag-1'] });
      planRepo.save.mockResolvedValue(savedPlan);

      await service.create(dto);

      expect(decisionSupportService.evaluateTreatmentPlan).toHaveBeenCalledWith('plan-1', ['diag-1']);
    });
  });

  describe('findById', () => {
    it('returns the plan with relations', async () => {
      const plan = makePlan();
      planRepo.findOne.mockResolvedValue(plan);
      const result = await service.findById('plan-1');
      expect(result).toEqual(plan);
      expect(planRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'plan-1' },
          relations: ['procedures', 'outcomes', 'versions'],
        }),
      );
    });

    it('throws NotFoundException when not found', async () => {
      planRepo.findOne.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByPatientId', () => {
    it('returns plans for a patient ordered by date DESC', async () => {
      const plans = [makePlan()];
      planRepo.find.mockResolvedValue(plans);
      const result = await service.findByPatientId('patient-1');
      expect(result).toEqual(plans);
    });
  });

  describe('updateStatus', () => {
    it('sets completedDate when status is COMPLETED', async () => {
      const plan = makePlan();
      planRepo.findOne.mockResolvedValue(plan);
      planRepo.save.mockResolvedValue(plan);

      await service.updateStatus('plan-1', TreatmentPlanStatus.COMPLETED, 'doc-1');

      expect(plan.status).toBe(TreatmentPlanStatus.COMPLETED);
      expect(plan.completedDate).toBeDefined();
    });

    it('does not set completedDate for non-COMPLETED status', async () => {
      const plan = makePlan();
      planRepo.findOne.mockResolvedValue(plan);
      planRepo.save.mockResolvedValue(plan);

      await service.updateStatus('plan-1', TreatmentPlanStatus.ACTIVE, 'doc-1');

      expect(plan.completedDate).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('removes the plan', async () => {
      const plan = makePlan();
      planRepo.findOne.mockResolvedValue(plan);
      await service.delete('plan-1');
      expect(planRepo.remove).toHaveBeenCalledWith(plan);
    });
  });

  describe('getActivePlans', () => {
    it('queries for active plans', async () => {
      await service.getActivePlans('patient-1');
      expect(planRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { patientId: 'patient-1', status: TreatmentPlanStatus.ACTIVE },
        }),
      );
    });
  });

  describe('getProgress', () => {
    it('returns 0 progress when plan has no objectives, goals, or procedures', async () => {
      const plan = makePlan({
        objectives: [],
        goals: [],
        procedures: [],
        outcomes: [],
      });
      planRepo.findOne.mockResolvedValue(plan);

      const progress = await service.getProgress('plan-1');

      expect(progress.progressPercentage).toBe(0);
      expect(progress.objectives).toEqual({ total: 0, completed: 0 });
      expect(progress.goals).toEqual({ total: 0, achieved: 0 });
    });

    it('calculates correct progress percentage', async () => {
      const plan = makePlan({
        objectives: [
          { status: 'completed' },
          { status: 'in_progress' },
        ] as any,
        goals: [
          { achieved: true },
          { achieved: true },
          { achieved: false },
        ] as any,
        procedures: [
          { status: 'completed' },
        ] as any,
        outcomes: [{ id: 'o1' }] as any,
      });
      planRepo.findOne.mockResolvedValue(plan);

      const progress = await service.getProgress('plan-1');

      // objectiveScore = 1/2 = 0.5, goalScore = 2/3 ≈ 0.667, procedureScore = 1/1 = 1
      // average = (0.5 + 0.667 + 1) / 3 ≈ 0.722 → 72%
      expect(progress.progressPercentage).toBe(72);
      expect(progress.objectives).toEqual({ total: 2, completed: 1 });
      expect(progress.goals).toEqual({ total: 3, achieved: 2 });
      expect(progress.procedures).toEqual({ total: 1, completed: 1 });
      expect(progress.outcomesRecorded).toBe(1);
    });
  });

  describe('getVersionHistory', () => {
    it('returns versions ordered by version DESC', async () => {
      const versions = [{ version: 2 }, { version: 1 }] as TreatmentPlanVersion[];
      versionRepo.find.mockResolvedValue(versions);

      const result = await service.getVersionHistory('plan-1');
      expect(result).toEqual(versions);
      expect(versionRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { treatmentPlanId: 'plan-1' },
          order: { version: 'DESC' },
        }),
      );
    });
  });

  describe('search', () => {
    it('builds query with patientId filter', async () => {
      await service.search({ patientId: 'patient-1' } as any);
      expect(queryBuilderMock.andWhere).toHaveBeenCalledWith(
        'plan.patientId = :patientId',
        { patientId: 'patient-1' },
      );
    });

    it('builds query with status filter', async () => {
      await service.search({ status: TreatmentPlanStatus.ACTIVE } as any);
      expect(queryBuilderMock.andWhere).toHaveBeenCalledWith(
        'plan.status = :status',
        { status: TreatmentPlanStatus.ACTIVE },
      );
    });
  });
});
