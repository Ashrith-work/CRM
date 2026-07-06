'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { Tag } from '@crm/types';
import { createTag, listTags } from '@/lib/api';
import { TagBadge } from './ui';

/**
 * Multi-select tag control used in entity forms. Loads the org's tags, lets you
 * toggle membership, and create a new tag inline. Reports the selected tag ids.
 */
export function TagPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { getToken } = useAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await listTags(token);
      setTags(res.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((t) => t !== id) : [...selected, id]);

  const randomColor = () => {
    const palette = ['#274fd6', '#0ea5e9', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#64748b'];
    return palette[Math.floor(Math.random() * palette.length)];
  };

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const token = await getToken();
      if (!token) return;
      const tag = await createTag(token, { name, color: randomColor() });
      setTags((prev) => [...prev, tag]);
      onChange([...selected, tag.id]);
      setNewName('');
      setCreating(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const on = selected.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggle(tag.id)}
              className={`rounded-full border px-2 py-0.5 text-xs font-medium transition ${
                on ? 'border-transparent' : 'border-slate-300 text-slate-500 hover:bg-slate-50'
              }`}
              style={on ? { backgroundColor: `${tag.color}1a`, color: tag.color } : undefined}
            >
              {tag.name}
            </button>
          );
        })}
        {creating ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void submitNew())}
              placeholder="Tag name"
              className="w-28 rounded-full border border-slate-300 px-2 py-0.5 text-xs outline-none focus:border-brand-500"
            />
            <button type="button" onClick={() => void submitNew()} className="text-xs font-medium text-brand-600">
              Add
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50"
          >
            + New tag
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Read-only row of tag badges for detail views. */
export function TagList({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) return <span className="text-sm text-slate-400">No tags</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <TagBadge key={t.id} name={t.name} color={t.color} />
      ))}
    </div>
  );
}
