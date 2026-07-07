import { useEffect } from 'react';
import { View } from 'react-native';
import { NavProvider, useNav } from './navigation';
import { HomeMenu } from './screens/HomeMenu';
import { EntityList } from './screens/EntityList';
import { DetailScreen } from './screens/DetailScreen';
import { QuickAddContact, QuickAddLead } from './screens/QuickAdd';
import { PipelineScreen } from './screens/PipelineScreen';
import { DealDetail } from './screens/DealDetail';
import { DealEdit } from './screens/DealEdit';
import { QuickAddDeal } from './screens/QuickAddDeal';
import { TaskList } from './screens/TaskList';
import { TaskDetail } from './screens/TaskDetail';
import { QuickAddTask } from './screens/QuickAddTask';
import { Agenda } from './screens/Agenda';
import { NotificationList } from './screens/NotificationList';
import { usePushRegistration, setTaskTapHandler } from './push';

/** Renders the current screen from the nav stack. */
function Router(): React.JSX.Element {
  const { current } = useNav();
  switch (current.name) {
    case 'home':
      return <HomeMenu />;
    case 'list':
      return <EntityList entity={current.entity} />;
    case 'detail':
      return <DetailScreen entity={current.entity} id={current.id} />;
    case 'quickAddContact':
      return <QuickAddContact />;
    case 'quickAddLead':
      return <QuickAddLead />;
    case 'pipeline':
      return <PipelineScreen />;
    case 'dealDetail':
      return <DealDetail id={current.id} />;
    case 'dealEdit':
      return <DealEdit id={current.id} />;
    case 'quickAddDeal':
      return <QuickAddDeal />;
    case 'taskList':
      return <TaskList />;
    case 'taskDetail':
      return <TaskDetail id={current.id} />;
    case 'quickAddTask':
      return <QuickAddTask relatedType={current.relatedType} relatedId={current.relatedId} />;
    case 'agenda':
      return <Agenda />;
    case 'notifications':
      return <NotificationList />;
    default:
      return <HomeMenu />;
  }
}

/**
 * Registers for push and routes a tapped reminder push to its task. Lives inside
 * NavProvider so it can drive navigation.
 */
function PushBridge(): null {
  const { push } = useNav();
  usePushRegistration();
  useEffect(() => {
    setTaskTapHandler((taskId) => push({ name: 'taskDetail', id: taskId }));
    return () => setTaskTapHandler(null);
  }, [push]);
  return null;
}

/** Root of the authenticated experience (replaces the old single HomeScreen). */
export function AuthedApp(): React.JSX.Element {
  return (
    <NavProvider>
      <View style={{ flex: 1 }}>
        <PushBridge />
        <Router />
      </View>
    </NavProvider>
  );
}
