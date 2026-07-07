import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { Deal, Pipeline } from '@crm/types';
import { Card, colors, ErrorBox, Loading, Pill, PrimaryButton, Row, SecondaryButton } from '../ui';
import { useAuthedLoad } from '../useAuthedLoad';
import { useNav } from '../navigation';
import { formatMoney, getDeal, getPipeline, moveDeal, reopenDeal } from '../api';
import { ScreenHeader } from './ScreenHeader';
import { NotesSection, Timeline } from './EntityFeed';
import { stageColor } from './PipelineScreen';
import { FollowUpsCard } from './FollowUpsCard';

const STATUS_COLOR: Record<Deal['status'], string> = { OPEN: colors.brand, WON: '#16a34a', LOST: '#dc2626' };

export function DealDetail({ id }: { id: string }): React.JSX.Element {
  const { getToken } = useAuth();
  const { push } = useNav();
  const [refreshToken, setRefreshToken] = useState(0);
  const bump = () => setRefreshToken((n) => n + 1);
  const { state, reload } = useAuthedLoad<{ deal: Deal; pipeline: Pipeline }>(
    async (t) => {
      const deal = await getDeal(t, id);
      const pipeline = await getPipeline(t, deal.pipelineId);
      return { deal, pipeline };
    },
    [id, refreshToken],
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (fn: (token: string) => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token');
      await fn(token);
      await reload();
      bump();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const Frame = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHeader
        title={title}
        right={
          state.status === 'ready' ? (
            <TouchableOpacity onPress={() => push({ name: 'dealEdit', id })} hitSlop={8}>
              <Text style={styles.edit}>Edit</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />
      <View style={{ gap: 12 }}>{children}</View>
    </ScrollView>
  );

  if (state.status === 'loading') return <Frame title="Deal"><Loading /></Frame>;
  if (state.status === 'error') return <Frame title="Deal"><ErrorBox message={state.message} onRetry={() => void reload()} /></Frame>;

  const { deal, pipeline } = state.data;
  const stages = pipeline.stages;
  const stageName = stages.find((s) => s.id === deal.stageId)?.name ?? '—';
  const terminal = deal.status !== 'OPEN';
  const wonStage = stages.find((s) => s.type === 'WON');
  const lostStage = stages.find((s) => s.type === 'LOST');

  return (
    <Frame title={deal.name}>
      {deal.contact ? <QuickActions phone={deal.contact.phone} email={deal.contact.email} /> : null}

      <Card title="Deal">
        <Row label="Amount" value={formatMoney(deal.amountMinor, deal.currency)} />
        <Row label="Stage" value={stageName} />
        <Row label="Close date" value={deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toLocaleDateString() : '—'} />
        <Row label="Owner" value={deal.ownerId ?? '—'} />
        <View style={styles.statusLine}>
          <Text style={{ color: colors.muted }}>Status</Text>
          <Pill label={deal.status} color={STATUS_COLOR[deal.status]} />
        </View>
      </Card>

      {deal.contact || deal.company ? (
        <Card title="Associated">
          {deal.contact ? (
            <TouchableOpacity onPress={() => push({ name: 'detail', entity: 'CONTACT', id: deal.contact!.id })}>
              <Row label="Contact" value={`${deal.contact.firstName} ${deal.contact.lastName} ›`} />
            </TouchableOpacity>
          ) : null}
          {deal.company ? (
            <TouchableOpacity onPress={() => push({ name: 'detail', entity: 'COMPANY', id: deal.company!.id })}>
              <Row label="Company" value={`${deal.company.name} ›`} />
            </TouchableOpacity>
          ) : null}
        </Card>
      ) : null}

      <Card title="Stage">
        <View style={styles.stageRow}>
          {stages.map((s) => {
            const active = s.id === deal.stageId;
            const c = stageColor(s.type);
            return (
              <TouchableOpacity
                key={s.id}
                disabled={busy || terminal || active}
                style={[styles.chip, active && { backgroundColor: c, borderColor: c }, (busy || terminal) && !active && styles.disabled]}
                onPress={() => void run((token) => moveDeal(token, id, { toStageId: s.id }))}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.actionRow}>
          {!terminal && wonStage ? (
            <PrimaryButton title="Mark Won" busy={busy} onPress={() => void run((token) => moveDeal(token, id, { toStageId: wonStage.id }))} />
          ) : null}
          {!terminal && lostStage ? (
            <SecondaryButton title="Mark Lost" onPress={() => void run((token) => moveDeal(token, id, { toStageId: lostStage.id }))} />
          ) : null}
          {terminal ? (
            <PrimaryButton title="Reopen deal" busy={busy} onPress={() => void run((token) => reopenDeal(token, id, {}))} />
          ) : null}
        </View>
        {terminal ? <Text style={styles.terminalNote}>Closed as {deal.status}. Reopen to move it again.</Text> : null}
      </Card>

      {actionError ? <ErrorBox message={actionError} /> : null}
      {deal.tags.length > 0 ? (
        <Card title="Tags">
          <View style={styles.tagRow}>{deal.tags.map((t) => <Pill key={t.id} label={t.name} color={t.color} />)}</View>
        </Card>
      ) : null}

      <FollowUpsCard relatedType="DEAL" relatedId={id} refreshToken={refreshToken} />
      <NotesSection entityType="DEAL" entityId={id} refreshToken={refreshToken} onChanged={bump} />
      <Timeline entityType="DEAL" entityId={id} refreshToken={refreshToken} />
    </Frame>
  );
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

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, backgroundColor: colors.bg, minHeight: '100%' },
  edit: { color: colors.brand, fontWeight: '700', fontSize: 15 },
  actions: { flexDirection: 'row', gap: 10 },
  statusLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  stageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.borderInput, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: '#fff' },
  disabled: { opacity: 0.5 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  terminalNote: { color: colors.muted, fontSize: 13, marginTop: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
