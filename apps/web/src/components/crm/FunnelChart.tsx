'use client';

import type { FunnelResponse } from '@crm/types';
import { percent } from './MetricTile';

/**
 * Dependency-free horizontal funnel: one bar per stage, width proportional to
 * the DISTINCT deals that passed through it, with stage-to-stage conversion.
 */
export function FunnelChart({ funnel }: { funnel: FunnelResponse }) {
  const max = Math.max(1, ...funnel.stages.map((s) => s.dealsEntered));

  if (funnel.stages.length === 0) {
    return <p className="text-sm text-slate-400">This pipeline has no stages.</p>;
  }

  return (
    <div className="space-y-2">
      {funnel.stages.map((s) => (
        <div key={s.stageId} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-sm font-medium text-slate-600" title={s.stageName}>
            {s.stageName}
          </span>
          <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-slate-100">
            <div
              className="flex h-full items-center rounded-md bg-brand-500 px-2 text-xs font-semibold text-white transition-all"
              style={{ width: `${Math.max((s.dealsEntered / max) * 100, s.dealsEntered > 0 ? 8 : 0)}%` }}
            >
              {s.dealsEntered > 0 ? s.dealsEntered : ''}
            </div>
            {s.dealsEntered === 0 && (
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">0</span>
            )}
          </div>
          <span className="w-16 shrink-0 text-right text-xs text-slate-500">
            {s.conversionFromPrev === null ? '—' : percent(s.conversionFromPrev)}
          </span>
        </div>
      ))}
      <p className="pt-1 text-xs text-slate-500">
        Overall conversion (last / first stage):{' '}
        <span className="font-semibold text-slate-700">{percent(funnel.overallConversion)}</span>
      </p>
    </div>
  );
}
