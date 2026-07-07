import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { EntityType, LeadStatus } from '@crm/types';
import { LEAD_STATUSES } from '@crm/types';
import { Card, colors, ErrorBox, Loading, Pill, PrimaryButton, Row, SecondaryButton } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { getCompany, getContact, getLead, convertLead, updateLeadStatus, type TokenGetter } from '../api';
import { ScreenHeader } from './ScreenHeader';
import { NotesSection, Timeline } from './EntityFeed';
import { STATUS_COLOR } from './EntityList';
import { FollowUpsCard } from './FollowUpsCard';
import { CallsCard } from './CallsCard';

function useRefresh(): [number, () => void] {
  const [n, setN] = useState(0);
  return [n, () => setN((x) => x + 1)];
}

export function DetailScreen({ entity, id }: { entity: EntityType; id: string }): React.JSX.Element {
  if (entity === 'CONTACT') return <ContactDetail id={id} />;
  if (entity === 'COMPANY') return <CompanyDetail id={id} />;
  return <LeadDetail id={id} />;
}

function QuickActions({ phone, email }: { phone?: string | null; email?: string | null }): React.JSX.Element | null {
  if (!phone && !email) return null;
  return (
    <View style={styles.actions}>
      {phone ? <SecondaryButton title="📞 Call" onPress={() => void Linking.openURL(`tel:${phone}`)} /> : null}
      {email ? <SecondaryButton title="✉️ Email" onPress={() => void Linking.openURL(`mailto:${email}`)} /> : null}
    </View>
  );
}

function Tags({ tags }: { tags: { id: string; name: string; color: string }[] }): React.JSX.Element | null {
  if (tags.length === 0) return null;
  return (
    <Card title="Tags">
      <View style={styles.tagRow}>
        {tags.map((t) => (
          <Pill key={t.id} label={t.name} color={t.color} />
        ))}
      </View>
    </Card>
  );
}

function CustomFields({ values }: { values: Record<string, unknown> }): React.JSX.Element | null {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;
  return (
    <Card title="Custom fields">
      {entries.map(([k, v]) => (
        <Row key={k} label={k} value={String(v)} />
      ))}
    </Card>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader title={title} />
      <View style={{ gap: 12 }}>{children}</View>
    </ScrollView>
  );
}

function ContactDetail({ id }: { id: string }): React.JSX.Element {
  const [refreshToken, bump] = useRefresh();
  const { state, reload } = useAuthedLoad((t) => getContact(t, id), [id, refreshToken]);

  if (state.status === 'loading') return <Frame title="Contact"><Loading /></Frame>;
  if (state.status === 'error') return <Frame title="Contact"><ErrorBox message={state.message} onRetry={() => void reload()} /></Frame>;
  const c = state.data;
  return (
    <Frame title={`${c.firstName} ${c.lastName}`}>
      <QuickActions phone={c.phone} email={c.email} />
      <Card title="Details">
        <Row label="Email" value={c.email ?? '—'} />
        <Row label="Phone" value={c.phone ?? '—'} />
        <Row label="Job title" value={c.jobTitle ?? '—'} />
        <Row label="Company" value={c.company?.name ?? '—'} />
      </Card>
      <Tags tags={c.tags} />
      <CustomFields values={c.customFields} />
      <CallsCard contactId={id} contactName={`${c.firstName} ${c.lastName}`} contactPhone={c.phone} />
      <FollowUpsCard relatedType="CONTACT" relatedId={id} refreshToken={refreshToken} />
      <NotesSection entityType="CONTACT" entityId={id} refreshToken={refreshToken} onChanged={bump} />
      <Timeline entityType="CONTACT" entityId={id} refreshToken={refreshToken} />
    </Frame>
  );
}

function CompanyDetail({ id }: { id: string }): React.JSX.Element {
  const [refreshToken, bump] = useRefresh();
  const { state, reload } = useAuthedLoad((t) => getCompany(t, id), [id, refreshToken]);

  if (state.status === 'loading') return <Frame title="Company"><Loading /></Frame>;
  if (state.status === 'error') return <Frame title="Company"><ErrorBox message={state.message} onRetry={() => void reload()} /></Frame>;
  const c = state.data;
  return (
    <Frame title={c.name}>
      <QuickActions phone={c.phone} />
      <Card title="Details">
        <Row label="Domain" value={c.domain ?? '—'} />
        <Row label="Industry" value={c.industry ?? '—'} />
        <Row label="Size" value={c.size ?? '—'} />
        <Row label="Website" value={c.website ?? '—'} />
        <Row label="Phone" value={c.phone ?? '—'} />
      </Card>
      <Tags tags={c.tags} />
      <CustomFields values={c.customFields} />
      <FollowUpsCard relatedType="COMPANY" relatedId={id} refreshToken={refreshToken} />
      <NotesSection entityType="COMPANY" entityId={id} refreshToken={refreshToken} onChanged={bump} />
      <Timeline entityType="COMPANY" entityId={id} refreshToken={refreshToken} />
    </Frame>
  );
}

function LeadDetail({ id }: { id: string }): React.JSX.Element {
  const { getToken } = useAuth();
  const [refreshToken, bump] = useRefresh();
  const { state, reload } = useAuthedLoad((t) => getLead(t, id), [id, refreshToken]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (fn: (getToken: TokenGetter) => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn(getToken);
      await reload();
      bump();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (state.status === 'loading') return <Frame title="Lead"><Loading /></Frame>;
  if (state.status === 'error') return <Frame title="Lead"><ErrorBox message={state.message} onRetry={() => void reload()} /></Frame>;
  const l = state.data;
  const converted = l.status === 'CONVERTED';
  const selectable: LeadStatus[] = LEAD_STATUSES.filter((s) => s !== 'CONVERTED');

  return (
    <Frame title={`${l.firstName} ${l.lastName}`}>
      <QuickActions phone={l.phone} email={l.email} />
      <Card title="Details">
        <Row label="Email" value={l.email ?? '—'} />
        <Row label="Phone" value={l.phone ?? '—'} />
        <Row label="Source" value={l.source ?? '—'} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 }}>
          <Text style={{ color: colors.muted }}>Status</Text>
          <Pill label={l.status} color={STATUS_COLOR[l.status]} />
        </View>
      </Card>

      <Card title="Status">
        <View style={styles.statusRow}>
          {selectable.map((s) => {
            const active = l.status === s;
            return (
              <TouchableOpacity
                key={s}
                disabled={busy || converted || active}
                style={[styles.statusBtn, active && styles.statusBtnActive, (busy || converted) && styles.disabled]}
                onPress={() => void run((token) => updateLeadStatus(token, id, s))}
              >
                <Text style={[styles.statusBtnText, active && styles.statusBtnTextActive]}>{s}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      <Card title="Convert">
        {converted ? (
          <Text style={{ color: colors.muted }}>
            Converted to a contact{l.convertedContactId ? ` (${l.convertedContactId})` : ''}.
          </Text>
        ) : (
          <PrimaryButton
            title="Convert to contact"
            busy={busy}
            onPress={() => void run((token) => convertLead(token, id, {}))}
          />
        )}
      </Card>

      {actionError ? <ErrorBox message={actionError} /> : null}
      <Tags tags={l.tags} />
      <CustomFields values={l.customFields} />
      <FollowUpsCard relatedType="LEAD" relatedId={id} refreshToken={refreshToken} />
      <NotesSection entityType="LEAD" entityId={id} refreshToken={refreshToken} onChanged={bump} />
      <Timeline entityType="LEAD" entityId={id} refreshToken={refreshToken} />
    </Frame>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%' },
  actions: { flexDirection: 'row', gap: 10 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusBtn: {
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  statusBtnActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  statusBtnText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  statusBtnTextActive: { color: '#fff' },
  disabled: { opacity: 0.6 },
});
