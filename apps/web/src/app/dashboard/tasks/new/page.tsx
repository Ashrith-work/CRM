'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { CreateTaskInput, RelatedType, TaskType } from '@crm/types';
import { createTask } from '@/lib/api';
import { Card, PageHeader, Spinner } from '@/components/crm/ui';
import { TaskForm } from '@/components/crm/TaskForm';

function NewTaskForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { getToken } = useAuth();

  const relatedType = (params.get('relatedType') as RelatedType | null) ?? undefined;
  const relatedId = params.get('relatedId') ?? undefined;
  const relatedLabel = params.get('relatedLabel') ?? undefined;
  const type = (params.get('type') as TaskType | null) ?? undefined;

  return (
    <div className="space-y-4">
      <PageHeader title="New task" />
      <Card>
        <TaskForm
          prefill={{ type, relatedType, relatedId, relatedLabel }}
          submitLabel="Create task"
          onCancel={() => router.back()}
          onSubmit={async (body: CreateTaskInput) => {
            const token = await getToken();
            if (!token) throw new Error('No session token available');
            const created = await createTask(token, body);
            router.push(`/dashboard/tasks/${created.id}`);
          }}
        />
      </Card>
    </div>
  );
}

export default function NewTaskPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <NewTaskForm />
    </Suspense>
  );
}
