import { AlertService } from './alert.service';
import { MedicationAdministrationRecord } from '../entities/medication-administration-record.entity';
import { MissedDose } from '../entities/missed-dose.entity';
import { AdverseDrugReaction, ReactionSeverity } from '../entities/adverse-drug-reaction.entity';

describe('AlertService', () => {
  let service: AlertService;

  beforeEach(() => {
    service = new AlertService();
  });

  describe('sendHighAlertRefusalAlert', () => {
    it('completes without throwing', async () => {
      const mar = {
        patientId: 'patient-1',
        medicationName: 'Warfarin',
        scheduledTime: new Date(),
        nurseId: 'nurse-1',
      } as MedicationAdministrationRecord;

      await expect(service.sendHighAlertRefusalAlert(mar)).resolves.not.toThrow();
    });
  });

  describe('sendCriticalMissedDoseAlert', () => {
    it('completes without throwing', async () => {
      const missedDose = {
        patientId: 'patient-1',
        medicationName: 'Insulin',
        scheduledTime: new Date(),
        reason: 'patient_unavailable',
        nurseId: 'nurse-1',
      } as MissedDose;

      await expect(service.sendCriticalMissedDoseAlert(missedDose)).resolves.not.toThrow();
    });
  });

  describe('sendSevereAdverseReactionAlert', () => {
    it('completes without throwing', async () => {
      const adr = {
        patientId: 'patient-1',
        medicationName: 'Penicillin',
        severity: ReactionSeverity.SEVERE,
        symptoms: 'Anaphylaxis',
        reporterId: 'doc-1',
      } as AdverseDrugReaction;

      await expect(service.sendSevereAdverseReactionAlert(adr)).resolves.not.toThrow();
    });
  });

  describe('sendMedicationDueAlert', () => {
    it('returns early for empty list', async () => {
      await expect(service.sendMedicationDueAlert([])).resolves.not.toThrow();
    });

    it('sends alert for non-empty list', async () => {
      const medications = [
        { id: 'm1', patientId: 'p1', medicationName: 'Drug-A', scheduledTime: new Date(), isHighAlert: false },
      ] as MedicationAdministrationRecord[];

      await expect(service.sendMedicationDueAlert(medications)).resolves.not.toThrow();
    });
  });

  describe('sendOverdueMedicationAlert', () => {
    it('returns early for empty list', async () => {
      await expect(service.sendOverdueMedicationAlert([])).resolves.not.toThrow();
    });

    it('sends alert for overdue medications', async () => {
      const medications = [
        { id: 'm1', patientId: 'p1', medicationName: 'Drug-A', scheduledTime: new Date(Date.now() - 3600000), isHighAlert: true },
      ] as MedicationAdministrationRecord[];

      await expect(service.sendOverdueMedicationAlert(medications)).resolves.not.toThrow();
    });
  });

  describe('sendBarcodeVerificationFailureAlert', () => {
    it('completes without throwing', async () => {
      await expect(
        service.sendBarcodeVerificationFailureAlert('mar-1', 'PATIENT_WRISTBAND', 'Barcode not readable'),
      ).resolves.not.toThrow();
    });
  });

  describe('sendReconciliationAlert', () => {
    it('completes without throwing', async () => {
      await expect(service.sendReconciliationAlert('patient-1', 3)).resolves.not.toThrow();
    });
  });

  describe('sendDrugInteractionAlert', () => {
    it('completes without throwing', async () => {
      await expect(
        service.sendDrugInteractionAlert('patient-1', [{ drug1: 'A', drug2: 'B' }]),
      ).resolves.not.toThrow();
    });
  });

  describe('sendPhysicianMissedDoseNotification', () => {
    it('completes without throwing', async () => {
      const missedDose = {
        patientId: 'patient-1',
        medicationName: 'Aspirin',
        scheduledTime: new Date(),
        reason: 'other',
        reasonDetails: 'Details',
        isCriticalMedication: false,
      } as MissedDose;

      await expect(service.sendPhysicianMissedDoseNotification(missedDose)).resolves.not.toThrow();
    });
  });

  describe('sendPhysicianAdverseReactionNotification', () => {
    it('completes without throwing', async () => {
      const adr = {
        patientId: 'patient-1',
        medicationName: 'Drug-X',
        severity: ReactionSeverity.MODERATE,
        symptoms: 'Nausea',
        reactionType: 'side_effect',
        reporterId: 'reporter-1',
      } as AdverseDrugReaction;

      await expect(service.sendPhysicianAdverseReactionNotification(adr)).resolves.not.toThrow();
    });
  });

  describe('sendPharmacyAdverseReactionNotification', () => {
    it('completes without throwing', async () => {
      const adr = {
        patientId: 'patient-1',
        medicationName: 'Drug-Y',
        severity: ReactionSeverity.MILD,
        symptoms: 'Drowsiness',
        reactionType: 'side_effect',
      } as AdverseDrugReaction;

      await expect(service.sendPharmacyAdverseReactionNotification(adr)).resolves.not.toThrow();
    });
  });
});
