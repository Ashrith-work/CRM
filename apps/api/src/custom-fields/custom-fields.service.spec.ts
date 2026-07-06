import { BadRequestException } from '@nestjs/common';
import { validateCustomFieldValues } from './custom-fields.service';

type Def = Parameters<typeof validateCustomFieldValues>[0][number];

const defs: Def[] = [
  { key: 'name', label: 'Name', fieldType: 'TEXT', options: null, required: true },
  { key: 'age', label: 'Age', fieldType: 'NUMBER', options: null, required: false },
  { key: 'active', label: 'Active', fieldType: 'BOOLEAN', options: null, required: false },
  { key: 'dob', label: 'DOB', fieldType: 'DATE', options: null, required: false },
  { key: 'tier', label: 'Tier', fieldType: 'SELECT', options: ['A', 'B'], required: false },
];

describe('validateCustomFieldValues', () => {
  it('accepts and coerces values by type', () => {
    const out = validateCustomFieldValues(defs, {
      name: 'Jane',
      age: '42', // string → number
      active: 'true', // string → boolean
      dob: '2020-01-02',
      tier: 'A',
    });
    expect(out.name).toBe('Jane');
    expect(out.age).toBe(42);
    expect(out.active).toBe(true);
    expect(typeof out.dob).toBe('string');
    expect(new Date(out.dob as string).getUTCFullYear()).toBe(2020);
    expect(out.tier).toBe('A');
  });

  it('throws when a required field is missing', () => {
    expect(() => validateCustomFieldValues(defs, { age: 1 })).toThrow(BadRequestException);
  });

  it('rejects unknown custom fields', () => {
    expect(() => validateCustomFieldValues(defs, { name: 'x', bogus: 1 })).toThrow(BadRequestException);
  });

  it('rejects a type mismatch and writes nothing (throws before returning)', () => {
    expect(() => validateCustomFieldValues(defs, { name: 'x', age: 'not-a-number' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a SELECT value outside its options', () => {
    expect(() => validateCustomFieldValues(defs, { name: 'x', tier: 'Z' })).toThrow(
      BadRequestException,
    );
  });

  it('treats empty string as absent (required still fails, optional ok)', () => {
    expect(() => validateCustomFieldValues(defs, { name: '' })).toThrow(BadRequestException);
    const out = validateCustomFieldValues(defs, { name: 'x', age: '' });
    expect(out).toEqual({ name: 'x' });
  });
});
