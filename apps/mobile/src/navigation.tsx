import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { EntityType } from '@crm/types';

/**
 * Dependency-free navigation. A simple screen stack in React state — no
 * react-navigation / expo-router (the app ships zero navigation deps). Screens
 * call useNav().push/pop; the Router in AuthedApp renders the top of the stack.
 */
export type Screen =
  | { name: 'home' }
  | { name: 'list'; entity: EntityType }
  | { name: 'detail'; entity: EntityType; id: string }
  | { name: 'quickAddContact' }
  | { name: 'quickAddLead' }
  // Milestone 2 — deals.
  | { name: 'pipeline' }
  | { name: 'dealDetail'; id: string }
  | { name: 'dealEdit'; id: string }
  | { name: 'quickAddDeal' }
  // Milestone 3 — tasks, agenda, notifications.
  | { name: 'taskList' }
  | { name: 'taskDetail'; id: string }
  | { name: 'quickAddTask'; relatedType?: EntityType; relatedId?: string }
  | { name: 'agenda' }
  | { name: 'notifications' }
  // Milestone 4 — dashboard glance.
  | { name: 'performance' }
  // Milestone 5 — calls.
  | { name: 'callHistory' }
  | { name: 'callDetail'; id: string }
  | { name: 'logCall'; contactId?: string; contactName?: string };

interface NavValue {
  current: Screen;
  canPop: boolean;
  push: (screen: Screen) => void;
  pop: () => void;
  reset: (screen: Screen) => void;
}

const NavContext = createContext<NavValue | null>(null);

export function NavProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [stack, setStack] = useState<Screen[]>([{ name: 'home' }]);

  const push = useCallback((screen: Screen) => setStack((s) => [...s, screen]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((screen: Screen) => setStack([screen]), []);

  const value = useMemo<NavValue>(
    () => ({ current: stack[stack.length - 1], canPop: stack.length > 1, push, pop, reset }),
    [stack, push, pop, reset],
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavValue {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used within a NavProvider');
  return ctx;
}
