import type { EntityType, LeadStatus } from '@crm/types';
import { useNav } from '../navigation';
import { listCompanies, listContacts, listLeads } from '../api';
import { ListView } from './ListView';

export const STATUS_COLOR: Record<LeadStatus, string> = {
  NEW: '#64748b',
  CONTACTED: '#0ea5e9',
  QUALIFIED: '#274fd6',
  UNQUALIFIED: '#dc2626',
  CONVERTED: '#16a34a',
};

/** Renders the correct list for the current entity. */
export function EntityList({ entity }: { entity: EntityType }): React.JSX.Element {
  const { push } = useNav();

  if (entity === 'CONTACT') {
    return (
      <ListView
        title="Contacts"
        addScreen={{ name: 'quickAddContact' }}
        fetchPage={listContacts}
        renderRow={(c) => ({
          primary: `${c.firstName} ${c.lastName}`.trim(),
          secondary: c.company?.name ?? c.email ?? c.phone ?? undefined,
        })}
        onOpen={(c) => push({ name: 'detail', entity: 'CONTACT', id: c.id })}
      />
    );
  }

  if (entity === 'COMPANY') {
    return (
      <ListView
        title="Companies"
        fetchPage={listCompanies}
        renderRow={(c) => ({
          primary: c.name,
          secondary: c.industry ?? c.domain ?? undefined,
        })}
        onOpen={(c) => push({ name: 'detail', entity: 'COMPANY', id: c.id })}
      />
    );
  }

  return (
    <ListView
      title="Leads"
      addScreen={{ name: 'quickAddLead' }}
      fetchPage={listLeads}
      renderRow={(l) => ({
        primary: `${l.firstName} ${l.lastName}`.trim(),
        secondary: l.source ?? l.email ?? undefined,
        badge: { label: l.status, color: STATUS_COLOR[l.status] },
      })}
      onOpen={(l) => push({ name: 'detail', entity: 'LEAD', id: l.id })}
    />
  );
}
