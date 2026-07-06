'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import {
  CUSTOM_FIELD_TYPES,
  ENTITY_TYPES,
  type CreateCustomFieldInput,
  type CustomFieldDefinition,
  type CustomFieldType,
  type EntityType,
} from '@crm/types';
import { createCustomField, deleteCustomField, listCustomFields } from '@/lib/api';
import { Button, Card, ErrorPanel, PageHeader, Spinner } from '@/components/crm/ui';

export default function CustomFieldsAdminPage() {
  const { getToken } = useAuth();
  const [entityType, setEntityType] = useState<EntityType>('CONTACT');
  const [defs, setDefs] = useState<CustomFieldDefinition[]>([]);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState('');

  // New-field form.
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<CustomFieldType>('TEXT');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token available');
      setDefs((await listCustomFields(token, entityType)).data);
      setStatus('ready');
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  }, [getToken, entityType]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setFormError('');
    try {
      const token = await getToken();
      if (!token) return;
      const body: CreateCustomFieldInput = {
        entityType,
        key: key.trim(),
        label: label.trim(),
        fieldType,
        required,
        order: defs.length,
        ...(fieldType === 'SELECT'
          ? { options: options.split(',').map((o) => o.trim()).filter(Boolean) }
          : {}),
      };
      await createCustomField(token, body);
      setKey('');
      setLabel('');
      setOptions('');
      setRequired(false);
      setFieldType('TEXT');
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this custom field?')) return;
    const token = await getToken();
    if (!token) return;
    await deleteCustomField(token, id);
    await load();
  };

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Custom fields"
        subtitle="Define extra fields per entity type."
        action={
          <Link href="/dashboard/settings/pipelines" className="text-sm font-medium text-brand-600 hover:underline">
            Pipelines & stages →
          </Link>
        }
      />

      <div className="flex gap-2">
        {ENTITY_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setEntityType(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              entityType === t ? 'bg-brand-600 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <Card title={`New ${entityType} field`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Key (snake_case) *</span>
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. linkedin" className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Label *</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. LinkedIn" className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Type</span>
            <select value={fieldType} onChange={(e) => setFieldType(e.target.value as CustomFieldType)} className={inputClass}>
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {fieldType === 'SELECT' && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Options (comma-separated) *</span>
              <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Low, Medium, High" className={inputClass} />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            <span className="font-medium text-slate-700">Required</span>
          </label>
        </div>
        {formError && <p className="mt-2 text-xs text-red-600">{formError}</p>}
        <div className="mt-3">
          <Button onClick={() => void add()} disabled={busy || !key.trim() || !label.trim()}>
            {busy ? 'Adding…' : 'Add field'}
          </Button>
        </div>
      </Card>

      <Card title={`${entityType} fields`}>
        {status === 'loading' ? (
          <Spinner />
        ) : status === 'error' ? (
          <ErrorPanel message={error} onRetry={() => void load()} />
        ) : defs.length === 0 ? (
          <p className="text-sm text-slate-400">No custom fields defined for {entityType}.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {defs.map((def) => (
              <li key={def.id} className="flex items-center justify-between py-2">
                <div className="text-sm">
                  <span className="font-medium">{def.label}</span>{' '}
                  <span className="text-slate-400">
                    ({def.key} · {def.fieldType}
                    {def.required ? ' · required' : ''})
                  </span>
                  {def.fieldType === 'SELECT' && def.options && (
                    <span className="ml-1 text-xs text-slate-400">[{def.options.join(', ')}]</span>
                  )}
                </div>
                <button onClick={() => void remove(def.id)} className="text-sm font-medium text-red-600 hover:underline">
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
