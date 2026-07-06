'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { Pipeline, Stage, StageType } from '@crm/types';
import {
  createPipeline,
  createStage,
  deletePipeline,
  deleteStage,
  listPipelines,
  reorderStages,
  updatePipeline,
  updateStage,
} from '@/lib/api';
import { Button, Card, ErrorPanel, PageHeader, Spinner } from '@/components/crm/ui';

const STAGE_TYPES: StageType[] = ['OPEN', 'WON', 'LOST'];

export default function PipelineAdminPage() {
  const { getToken } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newPipeline, setNewPipeline] = useState('');

  const withToken = useCallback(
    async <T,>(fn: (token: string) => Promise<T>): Promise<T | undefined> => {
      setError('');
      try {
        const token = await getToken();
        if (!token) throw new Error('No session token available');
        return await fn(token);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [getToken],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const res = await withToken((t) => listPipelines(t));
    if (res) setPipelines(res.data);
    setLoading(false);
  }, [withToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const addPipeline = async () => {
    const name = newPipeline.trim();
    if (!name) return;
    await withToken((t) => createPipeline(t, { name }));
    setNewPipeline('');
    await load();
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader title="Pipelines & stages" subtitle="Define your sales pipelines and their stages." />

      {error && <ErrorPanel message={error} />}

      <Card title="New pipeline">
        <div className="flex gap-2">
          <input
            value={newPipeline}
            onChange={(e) => setNewPipeline(e.target.value)}
            placeholder="Pipeline name"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <Button onClick={() => void addPipeline()}>Add</Button>
        </div>
      </Card>

      {pipelines.map((p) => (
        <PipelineEditor key={p.id} pipeline={p} withToken={withToken} onChange={load} />
      ))}
    </div>
  );
}

function PipelineEditor({
  pipeline,
  withToken,
  onChange,
}: {
  pipeline: Pipeline;
  withToken: <T>(fn: (token: string) => Promise<T>) => Promise<T | undefined>;
  onChange: () => Promise<void>;
}) {
  const [name, setName] = useState(pipeline.name);
  const [newStage, setNewStage] = useState('');

  const renamePipeline = async () => {
    if (name.trim() && name !== pipeline.name) {
      await withToken((t) => updatePipeline(t, pipeline.id, { name: name.trim() }));
      await onChange();
    }
  };

  const removePipeline = async () => {
    if (!confirm(`Delete pipeline "${pipeline.name}"? Blocked if it holds deals.`)) return;
    await withToken((t) => deletePipeline(t, pipeline.id));
    await onChange();
  };

  const addStage = async () => {
    const n = newStage.trim();
    if (!n) return;
    await withToken((t) => createStage(t, { pipelineId: pipeline.id, name: n, probability: 0, type: 'OPEN' }));
    setNewStage('');
    await onChange();
  };

  const move = async (index: number, dir: -1 | 1) => {
    const ids = pipeline.stages.map((s) => s.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await withToken((t) => reorderStages(t, { pipelineId: pipeline.id, stageIds: ids }));
    await onChange();
  };

  return (
    <Card
      title={pipeline.isDefault ? `${pipeline.name} (default)` : pipeline.name}
      action={
        <Button variant="danger" onClick={() => void removePipeline()}>
          Delete pipeline
        </Button>
      }
    >
      <div className="mb-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <Button variant="secondary" onClick={() => void renamePipeline()}>
          Rename
        </Button>
      </div>

      <div className="space-y-2">
        {pipeline.stages.map((stage, i) => (
          <StageRow
            key={stage.id}
            stage={stage}
            isFirst={i === 0}
            isLast={i === pipeline.stages.length - 1}
            onUp={() => void move(i, -1)}
            onDown={() => void move(i, 1)}
            withToken={withToken}
            onChange={onChange}
          />
        ))}
        {pipeline.stages.length === 0 && <p className="text-sm text-slate-400">No stages yet.</p>}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={newStage}
          onChange={(e) => setNewStage(e.target.value)}
          placeholder="New stage name"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <Button variant="secondary" onClick={() => void addStage()}>
          Add stage
        </Button>
      </div>
    </Card>
  );
}

function StageRow({
  stage,
  isFirst,
  isLast,
  onUp,
  onDown,
  withToken,
  onChange,
}: {
  stage: Stage;
  isFirst: boolean;
  isLast: boolean;
  onUp: () => void;
  onDown: () => void;
  withToken: <T>(fn: (token: string) => Promise<T>) => Promise<T | undefined>;
  onChange: () => Promise<void>;
}) {
  const [name, setName] = useState(stage.name);
  const [probability, setProbability] = useState(String(stage.probability));
  const [type, setType] = useState<StageType>(stage.type);
  const dirty = name !== stage.name || Number(probability) !== stage.probability || type !== stage.type;

  const save = async () => {
    await withToken((t) => updateStage(t, stage.id, { name: name.trim(), probability: Number(probability), type }));
    await onChange();
  };

  const remove = async () => {
    if (!confirm(`Delete stage "${stage.name}"? Blocked if it holds deals.`)) return;
    await withToken((t) => deleteStage(t, stage.id));
    await onChange();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="flex flex-col">
        <button onClick={onUp} disabled={isFirst} className="text-xs text-slate-500 disabled:opacity-30">
          ▲
        </button>
        <button onClick={onDown} disabled={isLast} className="text-xs text-slate-500 disabled:opacity-30">
          ▼
        </button>
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-[8rem] flex-1 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
      />
      <label className="flex items-center gap-1 text-xs text-slate-500">
        Prob
        <input
          type="number"
          min={0}
          max={100}
          value={probability}
          onChange={(e) => setProbability(e.target.value)}
          className="w-16 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
        />
        %
      </label>
      <select
        value={type}
        onChange={(e) => setType(e.target.value as StageType)}
        className="rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
      >
        {STAGE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {dirty && (
        <button onClick={() => void save()} className="text-xs font-medium text-brand-600">
          Save
        </button>
      )}
      <button onClick={() => void remove()} className="text-xs font-medium text-red-600">
        Delete
      </button>
    </div>
  );
}
