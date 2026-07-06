'use client';

import type { CustomFieldDefinition, CustomFieldValues } from '@crm/types';

/**
 * Renders inputs for a set of custom-field definitions and reports changes.
 * Values are kept as the raw form representation (strings/booleans); the API
 * coerces + validates by type on submit.
 */
export function CustomFieldRenderer({
  definitions,
  values,
  onChange,
}: {
  definitions: CustomFieldDefinition[];
  values: CustomFieldValues;
  onChange: (next: CustomFieldValues) => void;
}) {
  if (definitions.length === 0) return null;

  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  return (
    <div className="space-y-3">
      {definitions.map((def) => {
        const raw = values[def.key];
        const label = (
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {def.label}
            {def.required && <span className="text-red-500"> *</span>}
          </span>
        );
        const inputClass =
          'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500';

        if (def.fieldType === 'BOOLEAN') {
          return (
            <label key={def.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(raw)}
                onChange={(e) => set(def.key, e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="font-medium text-slate-700">
                {def.label}
                {def.required && <span className="text-red-500"> *</span>}
              </span>
            </label>
          );
        }

        if (def.fieldType === 'SELECT') {
          return (
            <label key={def.id} className="block">
              {label}
              <select value={typeof raw === 'string' ? raw : ''} onChange={(e) => set(def.key, e.target.value)} className={inputClass}>
                <option value="">— Select —</option>
                {(def.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        const inputType = def.fieldType === 'NUMBER' ? 'number' : def.fieldType === 'DATE' ? 'date' : 'text';
        return (
          <label key={def.id} className="block">
            {label}
            <input
              type={inputType}
              value={raw === undefined || raw === null ? '' : String(raw)}
              onChange={(e) => set(def.key, e.target.value)}
              className={inputClass}
            />
          </label>
        );
      })}
    </div>
  );
}
