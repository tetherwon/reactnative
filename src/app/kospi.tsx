import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import WebBottomNav from '@/components/WebBottomNav';
import { apiFetch, ApiError, apiFetchSWR } from '@/lib/api';
import * as haptics from '@/lib/haptics';
import { markWebStateDirty } from '@/lib/webNav';

// 웹 /kospi(static/kospi-inline-1.js)의 네이티브 구현.
// 평일 오전 9시 마감 상승/하락 예측 — 티켓 1장 응모, 맞히면 10캐시·틀려도 1캐시.

type KospiState = {
  id?: number;
  status?: string; // open | resolved | voided
  base_price?: number;
  close_price?: number;
  result?: string;
  trade_date?: string;
  my_choice?: string;
  my_result?: string;
  my_reward?: number;
  ticket_count?: number | null;
};
type KospiEntry = {
  trade_date?: string;
  choice?: string;
  result?: string;
  reward?: number;
  base_price?: number;
  close_price?: number;
};

const fmtPrice = (v?: number | null) =>
  v == null ? '—' : Number(v).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDateShort = (d?: string) => {
  const p = String(d || '').split('-');
  return p.length === 3 ? `${p[1]}.${p[2]}` : d || '';
};
const fmtDateKo = (d?: string) => {
  const p = String(d || '').split('-');
  return p.length === 3 ? `${Number(p[1])}월 ${Number(p[2])}일` : d || '';
};

export default function KospiScreen() {
  const [state, setState] = useState<KospiState | null>(null);
  const [entries, setEntries] = useState<KospiEntry[] | null>(null);
  const [choice, setChoice] = useState<'up' | 'down' | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    apiFetchSWR<KospiState>('/api/kospi/state', setState, 2 * 60_000).catch(() => {});
    apiFetchSWR<{ entries: KospiEntry[] }>('/api/kospi/history?limit=10', (d) =>
      setEntries(d.entries || []),
    ).catch((e) => {
      if (e instanceof ApiError && e.status === 401) router.back();
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const submit = () => {
    if (!choice || busy) return;
    setBusy(true);
    setMsg('');
    haptics.tap();
    apiFetch<{ ok?: boolean }>('/api/kospi/predict', {
      method: 'POST',
      body: JSON.stringify({ choice }),
    })
      .then(() => {
        markWebStateDirty(); // 티켓 차감
        haptics.success();
        setMsg('응모 완료! 결과는 정산 후 알려드려요.');
        load();
      })
      .catch((e) => {
        haptics.error();
        setMsg(e instanceof ApiError ? e.message : '잠깐 문제가 생겼어요. 다시 시도해 주세요.');
      })
      .finally(() => setBusy(false));
  };

  // 웹 renderState 로직 그대로
  const locked = !!(state && (state.my_choice || state.status !== 'open'));
  const priceLabel =
    state?.status === 'resolved' || state?.status === 'voided' ? '전일 종가' : '직전 거래일 종가';
  const priceValue =
    state?.status === 'resolved' ? fmtPrice(state.close_price) : state?.id ? fmtPrice(state.base_price) : '준비 중';
  const statusText = (() => {
    if (!state) return '';
    if (!state.id) return '잠시 후 오늘의 라운드가 열려요. (평일 오전 9시 마감)';
    if (state.my_choice) {
      if (state.my_result === 'win') return `정답! +${state.my_reward}캐시`;
      if (state.my_result === 'lose') return `아쉬워요, +${state.my_reward}캐시`;
      if (state.my_result === 'void') return '무효 처리 · 티켓 환불';
      return '응모 완료';
    }
    if (state.status === 'resolved')
      return state.result === 'up' ? '코스피가 상승 마감했어요.' : '코스피가 하락 마감했어요.';
    if (state.status === 'voided') return '휴장일 등으로 오늘 라운드는 무효 처리됐어요. 티켓은 환불됐어요.';
    return `${fmtDateKo(state.trade_date)} 오전 9시까지 응모할 수 있어요.`;
  })();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>코스피 예측</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 히어로: 기준가 + 상태 */}
        <View style={styles.hero}>
          <Text style={styles.priceLabel}>{priceLabel}</Text>
          <Text
            style={[
              styles.price,
              state?.status === 'resolved' && (state.result === 'up' ? styles.priceUp : styles.priceDown),
            ]}
          >
            {priceValue}
          </Text>
          <Text style={styles.statusText}>{statusText}</Text>
        </View>

        {/* 상승/하락 선택 */}
        <View style={styles.choices}>
          {(
            [
              ['up', '상승 📈', styles.choiceUp, styles.choiceUpSelected],
              ['down', '하락 📉', styles.choiceDown, styles.choiceDownSelected],
            ] as const
          ).map(([key, label, baseStyle, selStyle]) => {
            const selected = (state?.my_choice || choice) === key;
            return (
              <Pressable
                key={key}
                style={[styles.choiceBtn, baseStyle, selected && selStyle, locked && !selected && { opacity: 0.45 }]}
                onPress={() => {
                  if (locked) return;
                  haptics.tap();
                  setChoice(key);
                }}
                disabled={locked}
              >
                <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {!locked && state?.status === 'open' && (
          <Pressable
            style={[styles.submitBtn, (!choice || busy) && styles.submitBtnDisabled]}
            onPress={submit}
            disabled={!choice || busy}
          >
            <Text style={styles.submitBtnText}>{busy ? '응모 중…' : '티켓 1장으로 응모하기'}</Text>
          </Pressable>
        )}
        {!!msg && <Text style={styles.msg}>{msg}</Text>}

        {/* 내 참여 내역 (최근 3개 — 웹과 동일) */}
        <Text style={styles.sectionTitle}>내 참여 내역</Text>
        {entries === null ? (
          <Text style={styles.empty}>불러오는 중...</Text>
        ) : entries.length === 0 ? (
          <Text style={styles.empty}>아직 참여 내역이 없어요.</Text>
        ) : (
          entries.slice(0, 3).map((e, i) => {
            const rewardLabel =
              e.result === 'win'
                ? `+${e.reward}캐시`
                : e.result === 'lose'
                  ? `+${e.reward}캐시`
                  : e.result === 'void'
                    ? '무효(환불)'
                    : '정산 대기';
            let move = '';
            let moveUp = false;
            if (e.close_price != null && e.base_price != null && Number(e.base_price) > 0) {
              const pct = ((Number(e.close_price) - Number(e.base_price)) / Number(e.base_price)) * 100;
              moveUp = pct >= 0;
              move = `${fmtPrice(e.close_price)} (${pct > 0 ? '+' : ''}${pct.toFixed(2).replace(/\.?0+$/, '')}%)`;
            }
            return (
              <View key={i} style={styles.historyRow}>
                <Text style={styles.historyDate}>{fmtDateShort(e.trade_date)}</Text>
                <Text style={styles.historyChoice}>{e.choice === 'up' ? '상승' : '하락'} 예측</Text>
                {!!move && (
                  <Text style={[styles.historyMove, moveUp ? styles.priceUp : styles.priceDown]}>{move}</Text>
                )}
                <Text style={[styles.historyReward, e.result === 'win' && styles.historyRewardWin]}>
                  {rewardLabel}
                </Text>
              </View>
            );
          })
        )}

        {/* 이렇게 진행돼요 (웹 문구 그대로) */}
        <Text style={styles.sectionTitle}>이렇게 진행돼요</Text>
        <View style={styles.stepList}>
          <Text style={styles.stepItem}>1. 정산일 아침 9시까지 상승/하락 중 하나를 예측해 응모해요. (티켓 1장 소모)</Text>
          <Text style={styles.stepItem}>2. 예측이 맞으면 10캐시, 틀리면 참여 보상으로 1캐시를 드려요.</Text>
          <Text style={styles.stepItem}>3. 등락이 없는 날은 전원 무효 처리되고 티켓을 돌려드려요.</Text>
        </View>
      </ScrollView>
      <WebBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    height: 48,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backChevron: { fontSize: 30, color: '#1e293b', marginTop: -4 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  hero: {
    backgroundColor: '#f8fafc',
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 14,
  },
  priceLabel: { fontSize: 12.5, fontWeight: '700', color: '#8b95a1' },
  price: { fontSize: 34, fontWeight: '900', color: '#191f28', marginTop: 4, letterSpacing: -0.5 },
  priceUp: { color: '#e42939' },
  priceDown: { color: '#2563eb' },
  statusText: { fontSize: 13, color: '#4e5968', marginTop: 8, textAlign: 'center' },
  choices: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  choiceBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  choiceUp: { borderColor: '#fecaca', backgroundColor: '#fef7f7' },
  choiceUpSelected: { backgroundColor: '#e42939', borderColor: '#e42939' },
  choiceDown: { borderColor: '#bfdbfe', backgroundColor: '#f5f9ff' },
  choiceDownSelected: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  choiceText: { fontSize: 16, fontWeight: '800', color: '#191f28' },
  choiceTextSelected: { color: '#ffffff' },
  submitBtn: {
    backgroundColor: '#3182f6',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  submitBtnDisabled: { backgroundColor: '#e2e8f0' },
  submitBtnText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },
  msg: { textAlign: 'center', fontSize: 13.5, fontWeight: '700', color: '#059669', marginTop: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#191f28', marginTop: 24, marginBottom: 10 },
  empty: { fontSize: 13.5, color: '#8b95a1', paddingVertical: 12 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  historyDate: { fontSize: 13, color: '#8b95a1', width: 44 },
  historyChoice: { fontSize: 13.5, fontWeight: '700', color: '#334155' },
  historyMove: { flex: 1, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  historyReward: { fontSize: 13.5, fontWeight: '800', color: '#8b95a1', marginLeft: 8 },
  historyRewardWin: { color: '#059669' },
  stepList: { gap: 7 },
  stepItem: { fontSize: 13.5, color: '#4e5968', lineHeight: 20 },
});
