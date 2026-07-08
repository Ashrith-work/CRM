'use client';

import { useState } from 'react';
import { resolveGlossary } from '@crm/types';

/**
 * The "ⓘ" that resolves a metric's meaning from the SINGLE glossary registry
 * (the same source that will feed the AI assistant + exports). Renders nothing
 * for an unknown key, so a number never means two things in two places.
 */
export function InfoTooltip({ metricKey }: { metricKey: string }) {
  const entry = resolveGlossary(metricKey);
  const [open, setOpen] = useState(false);
  if (!entry) return null;

  const title = `${entry.plainLanguage}\n\nHow: ${entry.formula}\nWindow: ${entry.dataWindow}`;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`About ${metricKey.replace(/_/g, ' ')}`}
        title={title}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-20 mb-1 w-56 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2 text-left text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <span className="block font-medium text-slate-800 dark:text-slate-100">{entry.plainLanguage}</span>
          <span className="mt-1 block text-slate-500 dark:text-slate-400">How: {entry.formula}</span>
          <span className="mt-0.5 block text-slate-400 dark:text-slate-500">Window: {entry.dataWindow}</span>
        </span>
      )}
    </span>
  );
}
