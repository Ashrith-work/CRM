'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { CustomFieldDefinition, CustomFieldValues, EntityType } from '@crm/types';
import { listCustomFields } from '@/lib/api';
import { Row } from './ui';

/** Read-only display of an entity's custom-field values, labelled by definition. */
export function CustomFieldView({
  entityType,
  values,
}: {
  entityType: EntityType;
  values: CustomFieldValues;
}) {
  const { getToken } = useAuth();
  const [defs, setDefs] = useState<CustomFieldDefinition[]>([]);

  const load = useCallback(async () => {
    const res = await listCustomFields(getToken, entityType);
    setDefs(res.data);
  }, [getToken, entityType]);

  useEffect(() => {
    void load();
  }, [load]);

  if (defs.length === 0) return <p className="text-sm text-slate-400">No custom fields defined.</p>;

  return (
    <div>
      {defs.map((def) => {
        const v = values[def.key];
        const display =
          def.fieldType === 'BOOLEAN' ? (v ? 'Yes' : 'No') : v === undefined || v === null || v === '' ? '—' : String(v);
        return <Row key={def.id} label={def.label} value={display} />;
      })}
    </div>
  );
}
