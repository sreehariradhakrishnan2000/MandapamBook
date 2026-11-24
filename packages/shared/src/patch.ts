import { z } from 'zod';

/**
 * The schema for a partial update (PATCH): every field optional, and no defaults.
 *
 * `schema.partial()` is not enough: Zod still fills in each field's default when the key
 * is missing, so `{ guestRooms: 6 }` would come out with `instantBook: true`,
 * `parkingCars: 0` and so on, silently resetting whatever the owner had saved.
 * Validation, strictness and the field types are unchanged.
 */
export function patchSchema<S extends z.ZodObject>(schema: S): ReturnType<S['partial']> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    const bare = field instanceof z.ZodDefault ? (field.removeDefault() as z.ZodType) : field;
    shape[key] = bare.optional();
  }
  return schema.extend(shape) as unknown as ReturnType<S['partial']>;
}
