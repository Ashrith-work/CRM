'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { CreateTaskInput, Task } from '@crm/types';
import { getTask, updateTask } from '@/lib/api';
import { Card, ErrorPanel, PageHeader, Spinner } from '@/components/crm/ui';
import { TaskForm } from '@/components/crm/TaskForm';

export default function EditTaskPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { getToken } = useAuth();
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; task?: Task; message?: string }>({
    status: 'loading',
  });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', task: await getTask(getToken, id) });
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
    }
  }, [getToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') return <ErrorPanel message={state.message ?? ''} onRetry={() => void load()} />;

  return (
    <div className="space-y-4">
      <PageHeader title="Edit task" />
      <Card>
        <TaskForm
          initial={state.task}
          submitLabel="Save changes"
          onCancel={() => router.push(`/dashboard/tasks/${id}`)}
          onSubmit={async (body: CreateTaskInput) => {
            await updateTask(getToken, id, body);
            router.push(`/dashboard/tasks/${id}`);
          }}
        />
      </Card>
    </div>
  );
}
