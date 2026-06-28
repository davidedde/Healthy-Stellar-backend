import { v4 as uuidv4 } from 'uuid';
import { Repository, Between, ObjectLiteral } from 'typeorm';

/**
 * Generates a reference number in the format `PREFIX-<timestamp>-<4-char UUID>`.
 *
 * Used by billing services for claim, payment, denial, and refund numbers.
 *
 * Example: `CLM-1719000000000-A1B2`
 */
export function generateTimestampRef(prefix: string): string {
  return `${prefix}-${Date.now()}-${uuidv4().substring(0, 4).toUpperCase()}`;
}

/**
 * Generates a date-sequenced reference number in the format
 * `PREFIX-YYYYMMDD-XXXX` where XXXX is the next sequential number for the day.
 *
 * Used by lab orders, pathology cases, etc.
 */
export async function generateDateSequenceRef<T extends ObjectLiteral>(
  prefix: string,
  repository: Repository<T>,
  dateColumn: string,
): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const where = { [dateColumn]: Between(startOfDay, endOfDay) } as Record<string, unknown>;
  const count = await repository.count({
    where: where as Parameters<typeof repository.count>[0]['where'],
  });

  const sequence = String(count + 1).padStart(4, '0');
  return `${prefix}-${year}${month}${day}-${sequence}`;
}
