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
    default:
      return <HomeMenu />;
  }
}

/** Root of the authenticated experience (replaces the old single HomeScreen). */
export function AuthedApp(): React.JSX.Element {
  return (
    <NavProvider>
      <View style={{ flex: 1 }}>
        <Router />
      </View>
    </NavProvider>
  );
}
