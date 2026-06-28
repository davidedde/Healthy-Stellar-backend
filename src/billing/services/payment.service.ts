import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, Between } from 'typeorm';
import { Payment } from '../entities/payment.entity';
import { Billing } from '../entities/billing.entity';
import { BillingLineItem } from '../entities/billing-line-item.entity';
import {
  CreatePaymentDto,
  UpdatePaymentDto,
  RefundPaymentDto,
  PaymentSearchDto,
} from '../dto/payment.dto';
import { PaymentStatus, PaymentMethod } from '../../common/enums';
import { v4 as uuidv4 } from 'uuid';
import { InvoicePdfService } from './invoice-pdf.service';
import { findOneOrFail } from '../../common/utils/entity-lookup.util';
import { generateTimestampRef } from '../../common/utils/reference-number.util';
import { getDayRange } from '../../common/utils/date-range.util';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Billing)
    private readonly billingRepository: Repository<Billing>,
    @InjectRepository(BillingLineItem)
    private readonly lineItemRepository: Repository<BillingLineItem>,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  async create(createDto: CreatePaymentDto): Promise<Payment> {
    const billing = await findOneOrFail(this.billingRepository, 'Billing', {
      where: { id: createDto.billingId },
      relations: ['lineItems'],
    });

    if (createDto.amount > billing.balance) {
      throw new BadRequestException(
        `Payment amount ($${createDto.amount}) exceeds outstanding balance ($${billing.balance})`,
      );
    }

    const paymentNumber = generateTimestampRef('PAY');

    const payment = this.paymentRepository.create({
      paymentNumber,
      billingId: createDto.billingId,
      claimId: createDto.claimId,
      patientId: createDto.patientId,
      paymentMethod: createDto.paymentMethod,
      status: PaymentStatus.PENDING,
      amount: createDto.amount,
      paymentDate: new Date(createDto.paymentDate),
      payerName: createDto.payerName,
      payerId: createDto.payerId,
      checkNumber: createDto.checkNumber,
      transactionId: createDto.transactionId || uuidv4(),
      eraNumber: createDto.eraNumber,
      isPatientPayment: createDto.isPatientPayment || false,
      isInsurancePayment: createDto.isInsurancePayment || false,
      paymentAllocation: createDto.paymentAllocation,
      cardDetails: createDto.cardDetails,
      achDetails: createDto.achDetails,
      notes: createDto.notes,
    });

    await this.paymentRepository.save(payment);

    const processedPayment = await this.processPayment(payment.id);

    return processedPayment;
  }

  async processPayment(paymentId: string): Promise<Payment> {
    const payment = await this.findById(paymentId);

    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(`Payment is already in ${payment.status} status`);
    }

    payment.status = PaymentStatus.PROCESSING;
    await this.paymentRepository.save(payment);

    try {
      if (payment.paymentAllocation && payment.paymentAllocation.length > 0) {
        for (const allocation of payment.paymentAllocation) {
          const lineItem = await this.lineItemRepository.findOne({
            where: { id: allocation.lineItemId },
          });

          if (lineItem) {
            lineItem.paidAmount = Number(lineItem.paidAmount) + allocation.amount;
            if (allocation.adjustmentAmount) {
              lineItem.adjustmentAmount =
                Number(lineItem.adjustmentAmount) + allocation.adjustmentAmount;
            }
            await this.lineItemRepository.save(lineItem);
          }
        }
      }

      const billing = await this.billingRepository.findOne({
        where: { id: payment.billingId },
        relations: ['lineItems', 'payments'],
      });

      if (billing) {
        billing.totalPayments = Number(billing.totalPayments) + Number(payment.amount);
        billing.balance = Number(billing.balance) - Number(payment.amount);

        if (payment.isInsurancePayment) {
          billing.insuranceResponsibility =
            Number(billing.insuranceResponsibility || 0) - Number(payment.amount);
        } else {
          billing.patientResponsibility =
            Number(billing.patientResponsibility || 0) - Number(payment.amount);
        }

        if (billing.balance <= 0) {
          billing.status = 'paid';
          billing.balance = 0;
        } else {
          billing.status = 'partial';
        }

        await this.billingRepository.save(billing);
      }

      payment.status = PaymentStatus.COMPLETED;
      payment.postedDate = new Date();
      await this.paymentRepository.save(payment);

      // Emit a patient-facing invoice PDF email once the payment is confirmed.
      // Best-effort: failures here must not roll back a successful payment.
      this.invoicePdfService.sendInvoiceEmail(payment.billingId).catch((error) => {
        this.logger.warn(
          `Failed to send invoice email for billing ${payment.billingId}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      });

      return payment;
    } catch (error) {
      payment.status = PaymentStatus.FAILED;
      payment.notes = `${payment.notes || ''}\nProcessing failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      await this.paymentRepository.save(payment);
      throw error;
    }
  }

  async findById(id: string): Promise<Payment> {
    return findOneOrFail(this.paymentRepository, 'Payment', {
      where: { id },
      relations: ['billing'],
    });
  }

  async findByPaymentNumber(paymentNumber: string): Promise<Payment> {
    return findOneOrFail(this.paymentRepository, 'Payment', {
      where: { paymentNumber },
      relations: ['billing'],
    });
  }

  async search(searchDto: PaymentSearchDto): Promise<{
    data: Payment[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page = 1, limit = 20, ...filters } = searchDto;
    const skip = (page - 1) * limit;

    const where: FindOptionsWhere<Payment> = {};

    if (filters.patientId) {
      where.patientId = filters.patientId;
    }

    if (filters.billingId) {
      where.billingId = filters.billingId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.paymentMethod) {
      where.paymentMethod = filters.paymentMethod;
    }

    if (filters.isPatientPayment !== undefined) {
      where.isPatientPayment = filters.isPatientPayment;
    }

    if (filters.isInsurancePayment !== undefined) {
      where.isInsurancePayment = filters.isInsurancePayment;
    }

    if (filters.startDate && filters.endDate) {
      where.paymentDate = Between(new Date(filters.startDate), new Date(filters.endDate));
    }

    const [data, total] = await this.paymentRepository.findAndCount({
      where,
      relations: ['billing'],
      skip,
      take: limit,
      order: { paymentDate: 'DESC' },
    });

    return { data, total, page, limit };
  }

  async update(id: string, updateDto: UpdatePaymentDto): Promise<Payment> {
    const payment = await this.findById(id);

    if (payment.status === PaymentStatus.COMPLETED) {
      throw new BadRequestException('Cannot update a completed payment');
    }

    Object.assign(payment, {
      ...updateDto,
      postedDate: updateDto.postedDate ? new Date(updateDto.postedDate) : payment.postedDate,
    });

    return this.paymentRepository.save(payment);
  }

  async refund(refundDto: RefundPaymentDto): Promise<Payment> {
    const originalPayment = await this.findById(refundDto.paymentId);

    if (originalPayment.status !== PaymentStatus.COMPLETED) {
      throw new BadRequestException('Can only refund completed payments');
    }

    const maxRefundable = Number(originalPayment.amount) - Number(originalPayment.refundedAmount);

    if (refundDto.refundAmount > maxRefundable) {
      throw new BadRequestException(
        `Refund amount ($${refundDto.refundAmount}) exceeds available amount ($${maxRefundable})`,
      );
    }

    const refundPaymentNumber = generateTimestampRef('REF');

    const refundPayment = this.paymentRepository.create({
      paymentNumber: refundPaymentNumber,
      billingId: originalPayment.billingId,
      patientId: originalPayment.patientId,
      paymentMethod: originalPayment.paymentMethod,
      status: PaymentStatus.COMPLETED,
      amount: -refundDto.refundAmount,
      paymentDate: new Date(),
      postedDate: new Date(),
      isPatientPayment: originalPayment.isPatientPayment,
      isInsurancePayment: originalPayment.isInsurancePayment,
      notes: `Refund for payment ${originalPayment.paymentNumber}: ${refundDto.reason}`,
    });

    await this.paymentRepository.save(refundPayment);

    originalPayment.refundedAmount =
      Number(originalPayment.refundedAmount) + refundDto.refundAmount;

    if (originalPayment.refundedAmount >= originalPayment.amount) {
      originalPayment.status = PaymentStatus.REFUNDED;
    } else {
      originalPayment.status = PaymentStatus.PARTIALLY_REFUNDED;
    }

    await this.paymentRepository.save(originalPayment);

    const billing = await this.billingRepository.findOne({
      where: { id: originalPayment.billingId },
    });

    if (billing) {
      billing.totalPayments = Number(billing.totalPayments) - refundDto.refundAmount;
      billing.balance = Number(billing.balance) + refundDto.refundAmount;

      if (billing.balance > 0) {
        billing.status = billing.totalPayments > 0 ? 'partial' : 'open';
      }

      await this.billingRepository.save(billing);
    }

    return refundPayment;
  }

  async getPaymentsByBilling(billingId: string): Promise<Payment[]> {
    return this.paymentRepository.find({
      where: { billingId },
      order: { paymentDate: 'DESC' },
    });
  }

  async getPaymentsByPatient(
    patientId: string,
    options?: { startDate?: Date; endDate?: Date },
  ): Promise<Payment[]> {
    const where: FindOptionsWhere<Payment> = { patientId };

    if (options?.startDate && options?.endDate) {
      where.paymentDate = Between(options.startDate, options.endDate);
    }

    return this.paymentRepository.find({
      where,
      relations: ['billing'],
      order: { paymentDate: 'DESC' },
    });
  }

  async getDailyPaymentSummary(date: Date): Promise<{
    totalPayments: number;
    totalAmount: number;
    byMethod: Record<string, { count: number; amount: number }>;
    patientPayments: { count: number; amount: number };
    insurancePayments: { count: number; amount: number };
  }> {
    const [startOfDay, endOfDay] = getDayRange(date);

    const payments = await this.paymentRepository.find({
      where: {
        paymentDate: Between(startOfDay, endOfDay),
        status: PaymentStatus.COMPLETED,
      },
    });

    const byMethod: Record<string, { count: number; amount: number }> = {};
    let patientCount = 0;
    let patientAmount = 0;
    let insuranceCount = 0;
    let insuranceAmount = 0;

    for (const payment of payments) {
      const method = payment.paymentMethod;
      if (!byMethod[method]) {
        byMethod[method] = { count: 0, amount: 0 };
      }
      byMethod[method].count += 1;
      byMethod[method].amount += Number(payment.amount);

      if (payment.isPatientPayment) {
        patientCount += 1;
        patientAmount += Number(payment.amount);
      }

      if (payment.isInsurancePayment) {
        insuranceCount += 1;
        insuranceAmount += Number(payment.amount);
      }
    }

    return {
      totalPayments: payments.length,
      totalAmount: payments.reduce((sum, p) => sum + Number(p.amount), 0),
      byMethod,
      patientPayments: { count: patientCount, amount: patientAmount },
      insurancePayments: { count: insuranceCount, amount: insuranceAmount },
    };
  }
}
