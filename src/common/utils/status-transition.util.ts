import { BadRequestException } from '@nestjs/common';

/**
 * Validates that a status transition is allowed according to a transition map.
 *
 * Replaces the identical `validateStatusTransition` private methods found in
 * lab-orders, specimens, and pathology-case services.
 *
 * @throws BadRequestException when the transition is not allowed.
 */
export function validateStatusTransition<T extends string>(
  currentStatus: T,
  newStatus: T,
  validTransitions: Record<T, T[]>,
): void {
  const allowed = validTransitions[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new BadRequestException(
      `Invalid status transition from ${currentStatus} to ${newStatus}`,
    );
  }
}
