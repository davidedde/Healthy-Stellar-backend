import { NotFoundException } from '@nestjs/common';
import { Repository, FindOneOptions, ObjectLiteral } from 'typeorm';

/**
 * Looks up an entity by ID (or custom FindOneOptions) and throws
 * NotFoundException when the record does not exist.
 *
 * Replaces the boilerplate:
 * ```
 * const entity = await repo.findOne({ where: { id }, relations });
 * if (!entity) throw new NotFoundException(`X with ID ${id} not found`);
 * return entity;
 * ```
 */
export async function findOneOrFail<T extends ObjectLiteral>(
  repository: Repository<T>,
  entityName: string,
  options: FindOneOptions<T>,
): Promise<T> {
  const entity = await repository.findOne(options);
  if (!entity) {
    const where = options.where as Record<string, unknown> | undefined;
    const raw = where?.id ?? where?.['claimNumber'] ?? where?.['paymentNumber'];
    const label = raw != null ? String(raw as string) : JSON.stringify(where);
    throw new NotFoundException(`${entityName} with ID ${label} not found`);
  }
  return entity;
}
