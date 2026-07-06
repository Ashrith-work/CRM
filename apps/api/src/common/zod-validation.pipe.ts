import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validates (and coerces) a request payload against a shared zod schema from
 * @crm/types. Used per-parameter, e.g. `@Body(new ZodValidationPipe(Create...))`.
 *
 * The global class-validator ValidationPipe is a no-op for these params because
 * their runtime metatype is a plain Object (no class metadata), so the two
 * pipes compose without conflict.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      });
    }
    return result.data;
  }
}
