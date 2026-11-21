import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ListingStatus } from '../../core/owner-api.service';

const LABELS: Record<ListingStatus, { text: string; cls: string }> = {
  DRAFT: { text: 'Draft', cls: 'bg-slate-100 text-slate-700' },
  PENDING_REVIEW: { text: 'In review', cls: 'bg-brand-50 text-brand-700' },
  APPROVED: { text: 'Live', cls: 'bg-leaf-600/10 text-leaf-600' },
  REJECTED: { text: 'Changes needed', cls: 'bg-red-50 text-red-700' },
  SUSPENDED: { text: 'Suspended', cls: 'bg-red-100 text-red-800' },
};

@Component({
  selector: 'app-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="rounded-full px-2.5 py-0.5 text-xs font-semibold" [class]="meta().cls">{{
    meta().text
  }}</span>`,
})
export class StatusChip {
  readonly status = input.required<ListingStatus>();
  protected readonly meta = computed(() => LABELS[this.status()]);
}
