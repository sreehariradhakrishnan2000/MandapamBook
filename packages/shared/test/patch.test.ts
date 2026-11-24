import { describe, expect, it } from 'vitest';
import { amenityUpdateSchema, cityUpdateSchema } from '../src/admin.js';
import {
  addonUpdateSchema,
  auditoriumSchema,
  auditoriumUpdateSchema,
  hallUpdateSchema,
} from '../src/listing.js';

describe('update (PATCH) schemas', () => {
  it('keeps only the fields that were sent: no defaults fill the rest', () => {
    expect(auditoriumUpdateSchema.parse({ guestRooms: 6 })).toEqual({ guestRooms: 6 });
    expect(hallUpdateSchema.parse({ diningIsAc: true })).toEqual({ diningIsAc: true });
    expect(addonUpdateSchema.parse({ pricePaise: 50_000 })).toEqual({ pricePaise: 50_000 });
    expect(cityUpdateSchema.parse({ name: 'Kochi' })).toEqual({ name: 'Kochi' });
    expect(amenityUpdateSchema.parse({})).toEqual({});
  });

  it('still validates the fields that were sent and refuses unknown ones', () => {
    expect(auditoriumUpdateSchema.safeParse({ advancePercent: 5 }).success).toBe(false);
    expect(auditoriumUpdateSchema.safeParse({ pincode: '12345' }).success).toBe(false);
    expect(hallUpdateSchema.safeParse({ seatingCapacity: 0 }).success).toBe(false);
    expect(auditoriumUpdateSchema.safeParse({ status: 'APPROVED' }).success).toBe(false);
  });

  it('leaves the create schemas and their defaults alone', () => {
    const created = auditoriumSchema.parse({
      name: 'Kailas Auditorium',
      cityId: '0b8f3c62-5c36-4bd3-9b1e-5d6a1f0e2c11',
      addressLine: '12/4, Temple Road',
      pincode: '680101',
      cateringPolicy: 'OUTSIDE_ALLOWED',
      decorationPolicy: 'OUTSIDE_ALLOWED',
    });
    expect(created).toMatchObject({
      instantBook: true,
      advancePercent: 25,
      sadyaPrepArea: false,
      cookingEquipment: false,
    });
  });
});
