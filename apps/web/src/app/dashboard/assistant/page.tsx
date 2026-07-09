'use client';

import { useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import type { AssistantAnswer, RuleGroup } from '@crm/types';
import { askAssistant } from '@/lib/api';
import { Card, PageHeader, Button, ErrorPanel } from '@/components/crm/ui';

/** A question + its resolved answer (or a pending/error placeholder). */
interface Turn {
  id: number;
  question: string;
  answer: AssistantAnswer | null;
  error: string | null;
}

const SUGGESTIONS = [
  'What was our net revenue trend?',
  'Who are our top 10 customers by revenue?',
  'Which customers are most at risk of churning?',
  'How is CLV distributed across bands?',
];

function buildSegmentHref(rule: RuleGroup): string {
  return `/dashboard/segments/new?preset=${encodeURIComponent(JSON.stringify(rule))}`;
}

export default function AssistantPage() {
  const { getToken } = useAuth();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const nextId = useRef(1);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || pending) return;
    const id = nextId.current++;
    setTurns((prev) => [{ id, question: text, answer: null, error: null }, ...prev]);
    setQuestion('');
    setPending(true);
    try {
      const answer = await askAssistant(getToken, text);
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, answer } : t)));
    } catch (err) {
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, error: (err as Error).message } : t)));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ask"
        subtitle="A read-only assistant that answers only from your org's data. It can analyze and explain — it never sends, changes, or deletes anything."
      />

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
          className="flex gap-2"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about revenue, churn, CLV, cohorts, margin, top customers, or a segment…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <Button type="submit" disabled={pending || !question.trim()}>
            {pending ? 'Thinking…' : 'Ask'}
          </Button>
        </form>
        {turns.length === 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void ask(s)}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </Card>

      {turns.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
          Ask a question to get a grounded answer. Every metric shows the definition it used, and answers respect your role — you only ever see what you&apos;re allowed to.
        </p>
      ) : (
        <div className="space-y-4">
          {turns.map((t) => (
            <TurnCard key={t.id} turn={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TurnCard({ turn }: { turn: Turn }) {
  return (
    <Card>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{turn.question}</p>

      {!turn.answer && !turn.error && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Looking through your data…</p>
      )}

      {turn.error && (
        <div className="mt-3">
          <ErrorPanel message={turn.error} />
        </div>
      )}

      {turn.answer && <Answer answer={turn.answer} />}
    </Card>
  );
}

function Answer({ answer }: { answer: AssistantAnswer }) {
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {answer.declinedAction && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            Read-only — can&apos;t act
          </span>
        )}
        {answer.cached && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            Cached
          </span>
        )}
      </div>

      <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{answer.answer}</p>

      {/* Segment hand-off — the assistant never acts, so the USER builds it. */}
      {answer.segmentHandoff && (
        <Link
          href={buildSegmentHref(answer.segmentHandoff.rules)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Build segment: {answer.segmentHandoff.label} →
        </Link>
      )}

      {/* Grounding — every metric named cites its glossary definition. */}
      {answer.citations.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Definitions used
          </p>
          <ul className="space-y-2">
            {answer.citations.map((c) => (
              <li key={c.metricKey} className="text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">{c.metricKey.replace(/_/g, ' ')}</span>
                <span className="text-slate-500 dark:text-slate-400"> — {c.plainLanguage}</span>
                <span className="mt-0.5 block text-slate-400 dark:text-slate-500">
                  How: {c.formula} · Window: {c.dataWindow}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What backed the answer — the safe tools that ran. */}
      {answer.toolsUsed.length > 0 && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          Backed by: {answer.toolsUsed.map((t) => t.tool).join(', ')}
        </p>
      )}
    </div>
  );
}
