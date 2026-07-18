import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import WebBottomNav from '@/components/WebBottomNav';
import { apiFetch, ApiError, apiFetchSWR, isNativeScreenEnabled } from '@/lib/api';
import * as haptics from '@/lib/haptics';
import { markWebStateDirty, requestWebNav } from '@/lib/webNav';

// 웹 /roulette 의 네이티브 구현. 휠은 웹 SVG를 그대로 구운 이미지
// (assets/images/roulette-wheel.png)를 reanimated 로 회전시킨다.
// ⚠️ 세그먼트 순서는 서버 ROULETTE_PRIZES(app/db.py) 순서와 같아야 한다.
// 서버 확률표가 바뀌면 /api/roulette/prizes 키 순서와 대조해 어긋나면
// 네이티브 스핀을 막고 웹 버전으로 폴백한다.
const WHEEL_IMAGE = require('../../assets/images/roulette-wheel.png');
const WHEEL_ORDER = ['miss', 'p3', 'p5', 'p10', 'p100', 'p1000', 'mega', 'p1'];
const SLICE_DEG = 360 / WHEEL_ORDER.length;

const WHEEL_SIZE = Math.min(Dimensions.get('window').width - 48, 380);

type Status = {
  logged_in: boolean;
  ticket_count?: number;
  streak_days?: number;
  checked_today?: boolean;
  spun_today?: boolean;
};
type Prize = { key: string; label: string; points: number; weight: number };
type SpinResult = {
  prize_key: string;
  prize_label: string;
  points: number;
  ticket_count: number;
};
type Winner = { prize_label: string; name?: string; masked?: string; email?: string };
type Spin = { id: number; prize_key: string; prize_label: string; points_awarded: number; created_at: number };

function fmtDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeDeg(v: number): number {
  return ((v % 360) + 360) % 360;
}

function openWeb(path: string) {
  haptics.tap();
  // 웹뷰 화면을 리마운트하지 않고(웹뷰 리로드 방지) 목적지만 넘긴 뒤 네이티브 스택을 걷는다
  requestWebNav(path);
  router.dismissTo('/');
}

export default function RouletteScreen() {
  const [status, setStatus] = useState<Status | null>(null);
  const [orderMismatch, setOrderMismatch] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [history, setHistory] = useState<Spin[] | null>(null);
  const [checkinMsg, setCheckinMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const rotation = useSharedValue(0);
  const wheelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  // 누르는 즉시 등속 회전 시작(0.8초/바퀴) — 서버 응답을 기다리는 동안 멈춰 보이지 않게.
  // 응답이 오면 현재 각도에서 이어받아 감속 착지한다.
  const startIdleSpin = useCallback(() => {
    const current = rotation.value;
    rotation.value = withTiming(current + 360 * 1000, {
      duration: 800 * 1000,
      easing: Easing.linear,
    });
    // rotation 은 reanimated shared value(안정 참조)라 deps 불필요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = useCallback(() => {
    // SWR: 마지막 상태 즉시 표시 + 백그라운드 갱신 (티켓 수는 네트워크 값으로 곧 덮임)
    apiFetchSWR<Status>('/api/roulette/status', setStatus, 5 * 60_000).catch((e) => {
      if (e instanceof ApiError && e.status === 401) router.back();
    });
    apiFetchSWR<{ prizes: Prize[] }>('/api/roulette/prizes', (d) => {
      const keys = (d.prizes || []).map((p) => p.key);
      setOrderMismatch(keys.join(',') !== WHEEL_ORDER.join(','));
    }).catch(() => {});
    apiFetchSWR<{ winners: Winner[] }>('/api/roulette/recent', (d) =>
      setWinners((d.winners || []).slice(0, 5)),
    ).catch(() => {});
    apiFetchSWR<{ spins: Spin[] }>('/api/roulette/history?limit=5', (d) =>
      setHistory(d.spins || []),
    ).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll]),
  );

  const onSpinDone = useCallback((res: SpinResult) => {
    setSpinning(false);
    setResult(res);
    haptics.success();
  }, []);

  const spin = useCallback(() => {
    if (spinning) return;
    if (orderMismatch) return;
    const tickets = status?.ticket_count ?? 0;
    if (tickets <= 0) {
      setErrorMsg('티켓이 없어요. 충전 후 돌려주세요!');
      return;
    }
    setErrorMsg('');
    setSpinning(true);
    haptics.tap();
    startIdleSpin();
    apiFetch<SpinResult>('/api/roulette/spin', { method: 'POST' })
      .then((res) => {
        markWebStateDirty(); // 티켓·캐시 변동 — 웹뷰 복귀 시 웹 캐시 갱신
        setStatus((s) => (s ? { ...s, ticket_count: res.ticket_count } : s));
        const idx = WHEEL_ORDER.indexOf(res.prize_key);
        const safeIdx = idx >= 0 ? idx : 0;
        // 웹(roulette-inline-1.js)과 동일한 정지각 계산:
        // 포인터(top)에 슬라이스 중심이 오도록 현재 각도에서 3바퀴 + 보정 후 감속 착지
        cancelAnimation(rotation);
        const current = rotation.value;
        const desiredStop = normalizeDeg(-(safeIdx * SLICE_DEG + SLICE_DEG / 2));
        const adjustment = normalizeDeg(desiredStop - normalizeDeg(current));
        const target = current + 360 * 3 + adjustment;
        rotation.value = withTiming(
          target,
          { duration: 3000, easing: Easing.out(Easing.poly(4)) },
          (finished) => {
            if (finished) runOnJS(onSpinDone)(res);
          },
        );
      })
      .catch((e) => {
        // 부드럽게 멈추고 에러 표시
        cancelAnimation(rotation);
        rotation.value = withTiming(rotation.value + 120, {
          duration: 500,
          easing: Easing.out(Easing.quad),
        });
        setSpinning(false);
        setErrorMsg(e instanceof ApiError ? e.message : '잠깐 문제가 생겼어요. 다시 시도해 주세요.');
        haptics.error();
      });
  }, [spinning, orderMismatch, status, rotation, startIdleSpin, onSpinDone]);

  const checkIn = useCallback(() => {
    haptics.tap();
    apiFetch<{ streak_days: number; checked_today: boolean; ticket_awarded: boolean }>(
      '/api/roulette/check-in',
      { method: 'POST' },
    )
      .then((d) => {
        markWebStateDirty();
        setStatus((s) =>
          s ? { ...s, streak_days: d.streak_days, checked_today: true } : s,
        );
        setCheckinMsg(
          d.ticket_awarded ? '7일 달성! 티켓 1장을 받았어요 🎟️' : '출석 완료! 내일 또 만나요',
        );
        if (d.ticket_awarded) loadAll();
      })
      .catch(() => {});
  }, [loadAll]);

  const tickets = status?.ticket_count ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>오늘의 행운 룰렛</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 보유 티켓 배지 */}
        <View style={styles.ticketBadge}>
          <Text style={styles.ticketBadgeText}>
            보유 티켓 <Text style={styles.ticketCount}>{tickets}</Text>장
          </Text>
        </View>

        {/* 휠 */}
        <View style={styles.wheelWrap}>
          <View style={styles.pointer} />
          <Animated.View style={[styles.wheel, wheelStyle]}>
            <Image source={WHEEL_IMAGE} style={styles.wheelImg} contentFit="contain" />
          </Animated.View>
          <Pressable style={styles.startBtn} onPress={spin} disabled={spinning}>
            <Text style={styles.startBtnText}>START</Text>
          </Pressable>
        </View>

        {orderMismatch ? (
          <Pressable style={styles.spinBtn} onPress={() => openWeb('/roulette?web=1')}>
            <Text style={styles.spinBtnText}>웹 버전으로 열기</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.spinBtn, (spinning || tickets <= 0) && styles.spinBtnDisabled]}
            onPress={spin}
            disabled={spinning}
          >
            <Text style={styles.spinBtnText}>
              {spinning ? '두구두구...' : tickets > 0 ? '티켓 1장으로 돌리기' : '티켓이 없어요'}
            </Text>
          </Pressable>
        )}
        {tickets <= 0 && !spinning && (
          <Pressable
            style={styles.chargeCta}
            onPress={() => {
              // tickets 가 네이티브면 웹뷰로 보내면 RN이 다시 가로채 루프 → 네이티브로 직행
              if (isNativeScreenEnabled('tickets')) {
                haptics.tap();
                router.push('/tickets');
              } else openWeb('/tickets');
            }}
          >
            <Text style={styles.chargeCtaText}>🎟️ 티켓 충전하고 돌리기</Text>
          </Pressable>
        )}
        {!!errorMsg && <Text style={styles.errorMsg}>{errorMsg}</Text>}

        {/* 7일 출석 챌린지 */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>7일 출석 챌린지</Text>
            <Text style={styles.sectionPill}>7일 출석하면 티켓 +1장</Text>
          </View>
          <View style={styles.streakRow}>
            {Array.from({ length: 7 }, (_, i) => {
              const filled = i < (status?.streak_days ?? 0) % 7 || (status?.streak_days ?? 0) >= 7;
              return (
                <View key={i} style={[styles.streakDot, filled && styles.streakDotOn]}>
                  <Text style={[styles.streakDotText, filled && styles.streakDotTextOn]}>
                    {i + 1}
                  </Text>
                </View>
              );
            })}
          </View>
          {checkinMsg ? (
            <Text style={styles.checkinMsg}>{checkinMsg}</Text>
          ) : status && !status.checked_today ? (
            <Pressable style={styles.checkinBtn} onPress={checkIn}>
              <Text style={styles.checkinBtnText}>오늘 출석 체크하기</Text>
            </Pressable>
          ) : (
            <Text style={styles.checkinMsg}>오늘 출석 완료! 내일 또 만나요</Text>
          )}
        </View>

        {/* 최근 당첨 */}
        {winners.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>최근 당첨 소식</Text>
            {winners.map((w, i) => (
              <View key={i} style={styles.winnerRow}>
                <Text style={styles.winnerIcon}>🎉</Text>
                <Text style={styles.winnerText} numberOfLines={1}>
                  <Text style={styles.winnerName}>{w.masked || w.name || '회원'}</Text>님이{' '}
                  <Text style={styles.winnerPrize}>{w.prize_label}</Text> 당첨!
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* 내 기록 (웹 rou-history-section 과 동일) */}
        {history !== null && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>내 기록</Text>
              <Pressable
                onPress={() => {
                  if (isNativeScreenEnabled('roulette-history')) {
                    haptics.tap();
                    router.push('/roulette-history');
                  } else openWeb('/roulette-history');
                }}
                hitSlop={8}
              >
                <Text style={styles.historyMore}>전체 기록 보기 →</Text>
              </Pressable>
            </View>
            {history.length === 0 ? (
              <Text style={styles.historyEmpty}>아직 참여 내역이 없어요. 룰렛을 돌려보세요.</Text>
            ) : (
              history.map((s, i) => {
                const isWin = s.points_awarded > 0;
                return (
                  <View key={s.id} style={[styles.historyRow, i > 0 && styles.historyRowBorder]}>
                    <Image
                      source={{ uri: 'https://shoppinglog.store/static/icons/cash.webp' }}
                      style={styles.historyCoin}
                      contentFit="contain"
                    />
                    <Text style={[styles.historyLabel, isWin ? styles.historyWin : styles.historyMiss]}>
                      {isWin ? `+${s.points_awarded.toLocaleString('ko-KR')}캐시` : s.prize_label}
                    </Text>
                    <Text style={styles.historyDate}>{fmtDate(s.created_at)}</Text>
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>
      <WebBottomNav />

      {/* 결과 모달 */}
      <Modal visible={result !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEmoji}>{result && result.points > 0 ? '🎉' : '🐻'}</Text>
            <Text style={styles.modalTitle}>
              {result && result.points > 0 ? '축하해요!' : '아쉬워요!'}
            </Text>
            <Text style={styles.modalPrize}>{result?.prize_label}</Text>
            {result && result.points > 0 && (
              <Text style={styles.modalPoints}>+{result.points.toLocaleString('ko-KR')}캐시 적립</Text>
            )}
            <Pressable
              style={styles.modalBtn}
              onPress={() => {
                setResult(null);
                loadAll();
              }}
            >
              <Text style={styles.modalBtnText}>
                {(status?.ticket_count ?? 0) > 0 ? '확인 (티켓 ' + (status?.ticket_count ?? 0) + '장 남음)' : '확인'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  scrollContent: { paddingHorizontal: 18, paddingBottom: 48, alignItems: 'center' },
  ticketBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginBottom: 14,
  },
  ticketBadgeText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  ticketCount: { color: '#2563eb', fontWeight: '900' },
  wheelWrap: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  pointer: {
    position: 'absolute',
    top: -6,
    zIndex: 10,
    width: 0,
    height: 0,
    borderLeftWidth: 14,
    borderRightWidth: 14,
    borderTopWidth: 24,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#ef4444',
  },
  wheel: { width: WHEEL_SIZE, height: WHEEL_SIZE },
  wheelImg: { width: '100%', height: '100%' },
  startBtn: {
    position: 'absolute',
    width: WHEEL_SIZE * 0.23,
    height: WHEEL_SIZE * 0.23,
    borderRadius: WHEEL_SIZE * 0.115,
    backgroundColor: '#2563eb',
    borderWidth: 4,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  startBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '900', letterSpacing: -0.5 },
  spinBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  spinBtnDisabled: { backgroundColor: '#94a3b8' },
  spinBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  chargeCta: { marginTop: 10, paddingVertical: 8 },
  chargeCtaText: { color: '#2563eb', fontSize: 14, fontWeight: '800' },
  errorMsg: { marginTop: 10, color: '#dc2626', fontSize: 13, fontWeight: '600' },
  section: {
    alignSelf: 'stretch',
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 16,
    marginTop: 18,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a', marginBottom: 6 },
  sectionPill: { fontSize: 11, fontWeight: '700', color: '#2563eb' },
  streakRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  streakDot: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakDotOn: { backgroundColor: '#2563eb' },
  streakDotText: { fontSize: 12, fontWeight: '800', color: '#94a3b8' },
  streakDotTextOn: { color: '#ffffff' },
  checkinBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  checkinBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  checkinMsg: { fontSize: 13, color: '#059669', fontWeight: '700', textAlign: 'center' },
  winnerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 6 },
  winnerIcon: { fontSize: 14 },
  winnerText: { flex: 1, fontSize: 13, color: '#475569' },
  winnerName: { fontWeight: '800', color: '#1e293b' },
  winnerPrize: { fontWeight: '800', color: '#2563eb' },
  historyMore: { fontSize: 13, fontWeight: '700', color: '#3182f6' },
  historyEmpty: { textAlign: 'center', color: '#64748b', paddingVertical: 24, fontSize: 14 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  historyRowBorder: { borderTopWidth: 1, borderTopColor: '#eef1f4' },
  historyCoin: { width: 30, height: 30 },
  historyLabel: { flex: 1, fontSize: 16, fontWeight: '800' },
  historyWin: { color: '#3182f6' },
  historyMiss: { color: '#8b95a1' },
  historyDate: { fontSize: 14, color: '#8b95a1' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  modalCard: {
    alignSelf: 'stretch',
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  modalEmoji: { fontSize: 44, marginBottom: 8 },
  modalTitle: { fontSize: 20, fontWeight: '900', color: '#0f172a' },
  modalPrize: { fontSize: 17, fontWeight: '800', color: '#2563eb', marginTop: 8 },
  modalPoints: { fontSize: 14, fontWeight: '700', color: '#059669', marginTop: 4 },
  modalBtn: {
    marginTop: 20,
    alignSelf: 'stretch',
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
});
