import { Pipe, type PipeTransform } from '@angular/core';
import { formatInr } from '@mandapambook/shared';

/** Formats integer paise as rupees with Indian digit grouping: 15000000 → ₹1,50,000.00 */
@Pipe({ name: 'inr' })
export class InrPipe implements PipeTransform {
  transform(paise: number | null | undefined): string {
    return paise === null || paise === undefined ? '' : formatInr(paise);
  }
}

/** Whole rupees typed into a form → integer paise for the API. */
export function rupeesToPaiseInput(rupees: number): number {
  if (!Number.isFinite(rupees) || rupees < 0) throw new Error('invalid amount');
  return Math.round(rupees) * 100;
}
