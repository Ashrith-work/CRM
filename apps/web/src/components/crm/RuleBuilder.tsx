'use client';

import { SEGMENT_FIELDS, RULE_OPS, RFM_SEGMENTS, type RuleGroup, type RuleLeaf } from '@crm/types';

/**
 * Visual JSON rule-tree builder. Renders a {op, rules[]} group where each row is
 * a leaf (field/op/value) or a nested group. Controlled via value/onChange; the
 * same tree shape the backend translates into a safe parameterized query.
 */

type Node = RuleLeaf | RuleGroup;

function isLeaf(node: Node): node is RuleLeaf {
  return 'field' in node;
}

export function emptyGroup(): RuleGroup {
  return { op: 'AND', rules: [] };
}

const selectCls =
  'rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
const inputCls =
  'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

function LeafRow({ leaf, onChange, onRemove }: { leaf: RuleLeaf; onChange: (l: RuleLeaf) => void; onRemove: () => void }) {
  const isSegment = leaf.field === 'rSegment';
  const isIn = leaf.op === 'in';
  const valueStr = Array.isArray(leaf.value) ? leaf.value.join(', ') : String(leaf.value ?? '');

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900/50">
      <select
        className={selectCls}
        value={leaf.field}
        onChange={(e) => onChange({ ...leaf, field: e.target.value as RuleLeaf['field'] })}
      >
        {SEGMENT_FIELDS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <select className={selectCls} value={leaf.op} onChange={(e) => onChange({ ...leaf, op: e.target.value as RuleLeaf['op'] })}>
        {RULE_OPS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {isSegment && !isIn ? (
        <select className={selectCls} value={String(leaf.value ?? '')} onChange={(e) => onChange({ ...leaf, value: e.target.value })}>
          <option value="">—</option>
          {RFM_SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={`${inputCls} flex-1 min-w-[8rem]`}
          value={valueStr}
          placeholder={isIn ? 'comma,separated,values' : isSegment ? 'Champions' : 'value'}
          onChange={(e) => {
            const raw = e.target.value;
            const value = isIn ? raw.split(',').map((v) => v.trim()).filter(Boolean) : raw;
            onChange({ ...leaf, value });
          }}
        />
      )}
      <button type="button" onClick={onRemove} aria-label="Remove condition" className="rounded-md px-2 py-1 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
        ✕
      </button>
    </div>
  );
}

export function RuleBuilder({ value, onChange, depth = 0 }: { value: RuleGroup; onChange: (g: RuleGroup) => void; depth?: number }) {
  const setRule = (i: number, node: Node) => onChange({ ...value, rules: value.rules.map((r, idx) => (idx === i ? node : r)) });
  const removeRule = (i: number) => onChange({ ...value, rules: value.rules.filter((_, idx) => idx !== i) });
  const addLeaf = () => onChange({ ...value, rules: [...value.rules, { field: 'rSegment', op: 'eq', value: '' }] });
  const addGroup = () => onChange({ ...value, rules: [...value.rules, emptyGroup()] });

  return (
    <div className={`space-y-2 rounded-xl border p-3 ${depth ? 'border-slate-200 dark:border-slate-800' : 'border-transparent'}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Match</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
          {(['AND', 'OR'] as const).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => onChange({ ...value, op })}
              className={`px-3 py-1 text-sm font-medium ${value.op === op ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300'}`}
            >
              {op === 'AND' ? 'ALL' : 'ANY'}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">of the following</span>
      </div>

      <div className="space-y-2">
        {value.rules.map((node, i) =>
          isLeaf(node) ? (
            <LeafRow key={i} leaf={node} onChange={(l) => setRule(i, l)} onRemove={() => removeRule(i)} />
          ) : (
            <div key={i} className="relative">
              <RuleBuilder value={node} onChange={(g) => setRule(i, g)} depth={depth + 1} />
              <button type="button" onClick={() => removeRule(i)} className="absolute right-2 top-2 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
                Remove group
              </button>
            </div>
          ),
        )}
        {value.rules.length === 0 && <p className="text-sm text-slate-400">No conditions — add one to define the audience.</p>}
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={addLeaf} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
          + condition
        </button>
        {depth < 2 && (
          <button type="button" onClick={addGroup} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            + group
          </button>
        )}
      </div>
    </div>
  );
}
