import { inArray } from 'drizzle-orm';
import { type PlatformSettings, platformSettingsSchema } from '@mandapambook/shared';
import type { Db } from '../../db/client.js';
import { platformSettings } from '../../db/schema/index.js';
import { PLATFORM_SETTINGS } from '../../db/seed/master-data.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const KEYS = Object.keys(platformSettingsSchema.shape) as (keyof PlatformSettings)[];

/**
 * Typed access to platform settings. Missing keys fall back to the seeded defaults,
 * and stored values are validated, so a bad row can never reach pricing code.
 */
export class SettingsService {
  constructor(private readonly db: Db) {}

  async get(tx?: Tx): Promise<PlatformSettings> {
    const rows = await (tx ?? this.db)
      .select()
      .from(platformSettings)
      .where(inArray(platformSettings.key, KEYS));
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return platformSettingsSchema.parse({ ...PLATFORM_SETTINGS, ...stored });
  }

  /** Writes only the given keys; returns before/after values for auditing. */
  async update(
    changes: { [K in keyof PlatformSettings]?: PlatformSettings[K] | undefined },
    actorId: string,
  ): Promise<{ before: PlatformSettings; after: PlatformSettings }> {
    return this.db.transaction(async (tx) => {
      const before = await this.get(tx);
      const defined = Object.entries(changes).filter(([, v]) => v !== undefined);
      const after = platformSettingsSchema.parse({ ...before, ...Object.fromEntries(defined) });
      for (const [key, value] of defined) {
        await tx
          .insert(platformSettings)
          .values({ key, value, updatedBy: actorId })
          .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedBy: actorId } });
      }
      return { before, after };
    });
  }
}
