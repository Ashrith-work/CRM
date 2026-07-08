'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { RuleGroup, SegmentPreviewResponse } from '@crm/types';
import { previewSegment, saveSegment } from '@/lib/api';
import { Card, PageHeader, Button, Input, Spinner, formatMoney } from '@/components/crm/ui';
import { RuleBuilder, emptyGroup } from '@/components/crm/RuleBuilder';

function hasLeaf(group: RuleGroup): boolean {
  return group.rules.some((r) => ('field' in r ? true : hasLeaf(r)));
}

export default function NewSegmentPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [rules, setRules] = useState<RuleGroup>(emptyGroup());
  const [preview, setPreview] = useState<SegmentPreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewErr, setPreviewErr] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'STATIC' | 'DYNAMIC'>('STATIC');
  const [refreshCron, setRefreshCron] = useState('0 3 * * *');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  // "Build segment from this" — hydrate the builder from a ?preset= rule tree.
  useEffect(() => {
    try {
      const preset = new URLSearchParams(window.location.search).get('preset');
      if (!preset) return;
      const parsed = JSON.parse(preset);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.rules)) setRules(parsed as RuleGroup);
    } catch {
      /* ignore a malformed preset */
    }
  }, []);

  // Live preview (debounced) as the tree changes.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!hasLeaf(rules)) {
      setPreview(null);
      setPreviewErr('');
      return;
    }
    debounce.current = setTimeout(async () => {
      setPreviewing(true);
      setPreviewErr('');
      try {
        setPreview(await previewSegment(getToken, rules));
      } catch (err) {
        setPreviewErr((err as Error).message);
        setPreview(null);
      } finally {
        setPreviewing(false);
      }
    }, 400);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [rules, getToken]);

  const onSave = async () => {
    setSaving(true);
    setSaveErr('');
    try {
      const seg = await saveSegment(getToken, {
        name,
        description: description || undefined,
        rules,
        type,
        refreshCron: type === 'DYNAMIC' ? refreshCron : undefined,
      });
      router.push(`/dashboard/segments/${seg.id}`);
    } catch (err) {
      setSaveErr((err as Error).message);
      setSaving(false);
    }
  };

  const canSave = name.trim().length > 0 && hasLeaf(rules) && !saving;

  return (
    <div className="space-y-4">
      <PageHeader title="New segment" subtitle="Define the audience with a rule tree; preview updates live." />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title="Rules">
            <RuleBuilder value={rules} onChange={setRules} />
          </Card>

          <Card title="Save">
            <div className="space-y-3">
              <Input label="Name" value={name} onChange={setName} placeholder="Champions — repeat buyers" required />
              <Input label="Description" value={description} onChange={setDescription} placeholder="Optional" />
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-300">Type</span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as 'STATIC' | 'DYNAMIC')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="STATIC">Static — snapshot membership now</option>
                  <option value="DYNAMIC">Dynamic — recompute on a schedule</option>
                </select>
              </label>
              {type === 'DYNAMIC' && <Input label="Refresh cron" value={refreshCron} onChange={setRefreshCron} placeholder="0 3 * * *" required />}
              {saveErr && <p className="text-sm text-red-600">{saveErr}</p>}
              <Button onClick={onSave} disabled={!canSave}>
                {saving ? 'Saving…' : 'Save segment'}
              </Button>
            </div>
          </Card>
        </div>

        <Card title="Live preview">
          {!hasLeaf(rules) ? (
            <p className="py-8 text-center text-sm text-slate-400">Add a condition to preview the audience.</p>
          ) : previewErr ? (
            <p className="text-sm text-red-600">{previewErr}</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900 dark:text-slate-100">{preview ? preview.count.toLocaleString() : '—'}</span>
                <span className="text-sm text-slate-500">customers match {previewing && '(updating…)'}</span>
              </div>
              {preview && preview.sample.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                      <tr>
                        <th className="px-3 py-2">Customer</th>
                        <th className="px-3 py-2">Email</th>
                        <th className="px-3 py-2">Segment</th>
                        <th className="px-3 py-2 text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((r) => (
                        <tr key={r.customerId} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                          <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">{r.name}</td>
                          <td className="px-3 py-2 text-slate-500">{r.email ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-500">{r.rSegment ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">{formatMoney(r.netRevenueMinor, 'INR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-3 py-2 text-xs text-slate-400">Showing up to 20 of {preview.count.toLocaleString()}.</p>
                </div>
              ) : preview ? (
                <p className="py-6 text-center text-sm text-slate-400">No customers match — loosen the rules.</p>
              ) : (
                <Spinner label="Previewing…" />
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
