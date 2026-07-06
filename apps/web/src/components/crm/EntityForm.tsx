'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { CustomFieldDefinition, CustomFieldValues, EntityType } from '@crm/types';
import { listCustomFields } from '@/lib/api';
import { Button, ErrorPanel } from './ui';
import { CustomFieldRenderer } from './CustomFieldRenderer';
import { TagPicker } from './TagPicker';

export interface FormFieldDef {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'select' | 'date' | 'number';
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
}

export interface EntityFormValue {
  core: Record<string, string>;
  customFields: CustomFieldValues;
  tagIds: string[];
}

/**
 * Reusable create/edit form: caller-declared core fields + dynamically loaded
 * custom fields + a tag picker. Manages its own state and submits a normalized
 * value the caller maps into the entity's Create/Update input.
 */
export function EntityForm({
  entityType,
  fields,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  entityType: EntityType;
  fields: FormFieldDef[];
  initial?: Partial<EntityFormValue>;
  submitLabel: string;
  onSubmit: (value: EntityFormValue) => Promise<void>;
  onCancel?: () => void;
}) {
  const { getToken } = useAuth();
  const [core, setCore] = useState<Record<string, string>>(initial?.core ?? {});
  const [customValues, setCustomValues] = useState<CustomFieldValues>(initial?.customFields ?? {});
  const [tagIds, setTagIds] = useState<string[]>(initial?.tagIds ?? []);
  const [defs, setDefs] = useState<CustomFieldDefinition[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadDefs = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await listCustomFields(token, entityType);
      setDefs(res.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, entityType]);

  useEffect(() => {
    void loadDefs();
  }, [loadDefs]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onSubmit({ core, customFields: customValues, tagIds });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.name} className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              {f.label}
              {f.required && <span className="text-red-500"> *</span>}
            </span>
            {f.type === 'select' ? (
              <select value={core[f.name] ?? ''} onChange={(e) => setCore({ ...core, [f.name]: e.target.value })} className={inputClass}>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.type ?? 'text'}
                value={core[f.name] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setCore({ ...core, [f.name]: e.target.value })}
                className={inputClass}
              />
            )}
          </label>
        ))}
      </div>

      {defs.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Custom fields</h3>
          <CustomFieldRenderer definitions={defs} values={customValues} onChange={setCustomValues} />
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Tags</h3>
        <TagPicker selected={tagIds} onChange={setTagIds} />
      </div>

      {error && <ErrorPanel message={error} />}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
