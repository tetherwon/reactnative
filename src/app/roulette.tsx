import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import ConfettiBurst from '@/components/ConfettiBurst';
import WebBottomNav from '@/components/WebBottomNav';
import { apiFetch, ApiError, apiFetchSWR, BASE_URL, isNativeScreenEnabled } from '@/lib/api';
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

const SCREEN_W = Dimensions.get('window').width;
const WHEEL_SIZE = Math.min(SCREEN_W - 44, 360);

// 웹과 동일한 정적 에셋(서버 /static) — bg.png 는 서버에도 없어 하늘색 그라데이션만 사용
const IMG = {
  title: { uri: `${BASE_URL}/static/images/roulette/title.png` },
  cashGift: { uri: `${BASE_URL}/static/images/roulette/cash-gift.webp` },
  gom: { uri: `${BASE_URL}/static/images/gom/gom-nav.webp` },
  mega: { uri: `${BASE_URL}/static/logos/items/megacoffee.webp` },
  coinsLfar: { uri: `${BASE_URL}/static/images/roulette/coins-far-left.png` },
  coinsLnear: { uri: `${BASE_URL}/static/images/roulette/coins-left.png` },
  coinsRight: { uri: `${BASE_URL}/static/images/roulette/coins-right.png` },
  ticketBlue: { uri: `${BASE_URL}/static/images/roulette/ticket-blue.svg` },
  ticketWhite: { uri: `${BASE_URL}/static/images/roulette/ticket-white.svg` },
};

// 히어로에 떠다니는 티켓 장식(웹 rou-cf) — 히어로 좌우 가장자리에 흩뿌림
const HERO_DECO: { img: 'blue' | 'white'; left: string; top: number; size: number }[] = [
  { img: 'blue', left: '5%', top: 150, size: 18 },
  { img: 'blue', left: '80%', top: 226, size: 14 },
  { img: 'white', left: '15%', top: 208, size: 13 },
  { img: 'white', left: '85%', top: 168, size: 14 },
  { img: 'white', left: '89%', top: 262, size: 18 },
  { img: 'white', left: '6%', top: 262, size: 15 },
];

const CONSOLATIONS = ['다음엔 분명히!', '한 번 더 도전해보세요.', '오늘은 워밍업!', '행운은 다음 칸에 숨어있어요.'];

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
  total_points: number;
};
type Winner = { prize_label: string; name?: string; masked?: string; email?: string };
type Spin = { id: number; prize_key: string; prize_label: string; points_awarded: number; created_at: number };

function fmtDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function normalizeDeg(v: number): number {
  return ((v % 360) + 360) % 360;
}
function prizeTier(key: string): 'big' | 'medium' | 'small' {
  if (key === 'mega') return 'big';
  if (key === 'p100' || key === 'p1000') return 'medium';
  return 'small';
}
function openWeb(path: string) {
  haptics.tap();
  requestWebNav(path);
  router.dismissTo('/');
}
function goNativeOrWeb(screen: string, path: string) {
  if (isNativeScreenEnabled(screen)) {
    haptics.tap();
    router.push(path as never);
  } else openWeb(path);
}

// JS 카운트업(웹 animateCount 대응). active=false면 0.
function useCountUp(target: number, active: boolean): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active || target <= 0) return undefined;
    let raf = 0;
    const start = Date.now();
    const dur = target > 1000 ? 900 : 650;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active]);
  return val;
}

// ── 아이콘 (웹 인라인 SVG 그대로) ──
function IcLoveLetter() {
  return (
    <Svg viewBox="0 0 64 64" width="72%" height="72%">
      <Rect x={8} y={14} width={48} height={36} rx={5} fill="#e6e9ed" />
      <Path d="M9 48 L30 31 a3.2 3.2 0 0 1 4 0 L55 48 a5 5 0 0 1 -4 2 H13 a5 5 0 0 1 -4 -2z" fill="#f7f9fa" />
      <Path d="M9 16 L30 33 a3.2 3.2 0 0 0 4 0 L55 16 a5 5 0 0 0 -4 -2 H13 a5 5 0 0 0 -4 2z" fill="#d8dce1" />
      <Path
        d="M32 40.5 C 27 35.5, 21.5 32.7, 21.5 26.8 a5.9 5.9 0 0 1 10.5 -3.6 a5.9 5.9 0 0 1 10.5 3.6 c0 5.9 -5.5 8.7 -10.5 13.7z"
        fill="#ee4245"
      />
    </Svg>
  );
}
function IcCart() {
  return (
    <Svg viewBox="0 0 64 64" width="72%" height="72%">
      <Path d="M21 20 h34 a1.6 1.6 0 0 1 1.5 2.1 L51 41 a3 3 0 0 1 -2.9 2.2 H27.5 a3 3 0 0 1 -2.9 -2.3z" fill="#cbd1d8" />
      <Path
        d="M10 13 h5.5 a3 3 0 0 1 2.9 2.3 L25 43.2 h24"
        fill="none"
        stroke="#7b838e"
        strokeWidth={3.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={28.5} cy={51} r={4.6} fill="#3a4354" />
      <Circle cx={28.5} cy={51} r={1.7} fill="#8f97a5" />
      <Circle cx={46.5} cy={51} r={4.6} fill="#3a4354" />
      <Circle cx={46.5} cy={51} r={1.7} fill="#8f97a5" />
    </Svg>
  );
}
function IcTicket() {
  return (
    <Svg viewBox="0 0 64 64" width="72%" height="72%">
      <Rect x={10} y={17} width={44} height={30} rx={4.5} fill="#27ae60" />
      <Rect x={10} y={17} width={44} height={30} rx={4.5} fill="none" stroke="#1f9152" strokeWidth={2} />
      <Circle cx={10} cy={32} r={5} fill="#f3f4f6" />
      <Circle cx={54} cy={32} r={5} fill="#f3f4f6" />
      <Path d="M32 22.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L32 37.3l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z" fill="#177c47" />
    </Svg>
  );
}
function IcArrowIn({ muted }: { muted?: boolean }) {
  return (
    <Svg viewBox="0 0 24 24" width={22} height={22}>
      <Path
        d="M17 7 7 17 M15 17 H7 V9"
        fill="none"
        stroke={muted ? '#9ca3af' : '#3182f6'}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
function IcCard() {
  // 웹 /static/ic_card.svg (티켓 배지 아이콘)
  return (
    <Svg viewBox="0 0 24 24" width={20} height={20}>
      <Path
        d="M5.84668 5H22.0733C23.0454 5 23.8333 5.78798 23.8333 6.76V17.44C23.8333 18.412 23.0454 19.2 22.0733 19.2H5.84668V5Z"
        fill="#1370FB"
      />
      <Path
        d="M14.2169 9.02501C14.4807 8.52323 15.1992 8.52323 15.4631 9.02501L15.9778 10.004C16.0798 10.1978 16.2661 10.3331 16.4819 10.3702L17.572 10.5572C18.1307 10.6531 18.3528 11.3364 17.9571 11.7424L17.1851 12.5345C17.0323 12.6914 16.9611 12.9104 16.9926 13.1271L17.1515 14.2216C17.233 14.7827 16.6518 15.205 16.1433 14.9541L15.1515 14.4647C14.9551 14.3678 14.7248 14.3678 14.5285 14.4647L13.5366 14.9541C13.0282 15.205 12.4469 14.7827 12.5284 14.2216L12.6873 13.1271C12.7188 12.9104 12.6476 12.6914 12.4948 12.5345L11.7228 11.7424C11.3271 11.3364 11.5492 10.6531 12.1079 10.5572L13.198 10.3702C13.4139 10.3331 13.6002 10.1978 13.7021 10.004L14.2169 9.02501Z"
        fill="#ffffff"
      />
      <Path
        d="M5.84631 5V19.2002H1.92639C0.954626 19.2001 0.166857 18.4122 0.166626 17.4404V15.3789C1.77223 15.1492 3.00647 13.7687 3.00647 12.0996C3.00627 10.4306 1.77216 9.04999 0.166626 8.82031V6.75977C0.166753 5.78793 0.954562 5.00013 1.92639 5H5.84631Z"
        fill="#4F95FF"
      />
    </Svg>
  );
}

export default function RouletteScreen() {
  const [status, setStatus] = useState<Status | null>(null);
  const [orderMismatch, setOrderMismatch] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [feedIdx, setFeedIdx] = useState(0);
  const [history, setHistory] = useState<Spin[] | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [burst, setBurst] = useState(0);
  const [burstCount, setBurstCount] = useState(0);
  const [consolation, setConsolation] = useState(CONSOLATIONS[0]);

  const rotation = useSharedValue(0);
  const wheelStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  const startIdleSpin = useCallback(() => {
    const current = rotation.value;
    rotation.value = withTiming(current + 360 * 1000, { duration: 800 * 1000, easing: Easing.linear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = useCallback(() => {
    apiFetchSWR<Status>('/api/roulette/status', setStatus, 5 * 60_000).catch((e) => {
      if (e instanceof ApiError && e.status === 401) router.back();
    });
    apiFetchSWR<{ prizes: Prize[] }>('/api/roulette/prizes', (d) => {
      const keys = (d.prizes || []).map((p) => p.key);
      setOrderMismatch(keys.join(',') !== WHEEL_ORDER.join(','));
    }).catch(() => {});
    apiFetchSWR<{ winners: Winner[] }>('/api/roulette/recent', (d) => setWinners((d.winners || []).slice(0, 8))).catch(
      () => {},
    );
    apiFetchSWR<{ spins: Spin[] }>('/api/roulette/history?limit=5', (d) => setHistory(d.spins || [])).catch(() => {});
    // 웹과 동일하게 진입 시 자동 출석 체크인 (버튼 없음)
    apiFetch<{ streak_days: number; checked_today: boolean; ticket_awarded: boolean }>('/api/roulette/check-in', {
      method: 'POST',
    })
      .then((d) => {
        markWebStateDirty();
        setStatus((s) => (s ? { ...s, streak_days: d.streak_days, checked_today: true } : s));
        if (d.ticket_awarded) {
          haptics.success();
          apiFetchSWR<Status>('/api/roulette/status', setStatus, 0).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll]),
  );

  useEffect(() => {
    if (winners.length === 0) return undefined;
    const id = setInterval(() => setFeedIdx((i) => i + 1), 3500);
    return () => clearInterval(id);
  }, [winners.length]);

  const onSpinDone = useCallback((res: SpinResult) => {
    setSpinning(false);
    const tier = prizeTier(res.prize_key);
    const isMiss = res.points === 0 && res.prize_key === 'miss';
    if (isMiss) setConsolation(CONSOLATIONS[Math.floor(Date.now() / 1000) % CONSOLATIONS.length]);
    setResult(res);
    if (!isMiss) {
      setBurstCount(tier === 'big' ? 120 : tier === 'medium' ? 80 : 40);
      setBurst((b) => b + 1);
      haptics.success();
    } else {
      haptics.tap();
    }
  }, []);

  const spin = useCallback(() => {
    if (spinning || orderMismatch) return;
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
        markWebStateDirty();
        setStatus((s) => (s ? { ...s, ticket_count: res.ticket_count } : s));
        const idx = WHEEL_ORDER.indexOf(res.prize_key);
        const safeIdx = idx >= 0 ? idx : 0;
        cancelAnimation(rotation);
        const current = rotation.value;
        const desiredStop = normalizeDeg(-(safeIdx * SLICE_DEG + SLICE_DEG / 2));
        const adjustment = normalizeDeg(desiredStop - normalizeDeg(current));
        const target = current + 360 * 3 + adjustment;
        rotation.value = withTiming(target, { duration: 3000, easing: Easing.out(Easing.poly(4)) }, (finished) => {
          if (finished) runOnJS(onSpinDone)(res);
        });
      })
      .catch((e) => {
        cancelAnimation(rotation);
        rotation.value = withTiming(rotation.value + 120, { duration: 500, easing: Easing.out(Easing.quad) });
        setSpinning(false);
        setErrorMsg(e instanceof ApiError ? e.message : '잠깐 문제가 생겼어요. 다시 시도해 주세요.');
        haptics.error();
      });
  }, [spinning, orderMismatch, status, rotation, startIdleSpin, onSpinDone]);

  const tickets = status?.ticket_count ?? 0;
  const streakDays = status?.streak_days ?? 0;
  const checkedToday = status?.checked_today ?? false;
  const feedW = winners.length ? winners[feedIdx % winners.length] : null;

  // 결과 모달 파생값
  const res = result;
  const isMiss = res ? res.points === 0 && res.prize_key === 'miss' : false;
  const isItem = res ? res.prize_key === 'mega' : false;
  const isCash = !!res && !isMiss && !isItem && res.points > 0;
  const tier = res ? prizeTier(res.prize_key) : 'small';
  const ptsUp = useCountUp(res?.points ?? 0, isCash);
  const balUp = useCountUp(res?.total_points ?? 0, isCash);

  const streakStatusText = checkedToday
    ? streakDays >= 7
      ? '7일 출석 완료! 티켓을 받았어요'
      : '오늘 출석 완료! 내일 또 만나요'
    : '오늘 출석하고 도장을 받아보세요';

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
        {/* ── HERO ── */}
        <View style={styles.hero}>
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#c9def6" />
                <Stop offset="0.46" stopColor="#ddebfa" />
                <Stop offset="1" stopColor="#eef6ff" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#sky)" />
          </Svg>

          {HERO_DECO.map((d, i) => (
            <Image
              key={i}
              source={d.img === 'blue' ? IMG.ticketBlue : IMG.ticketWhite}
              style={{ position: 'absolute', left: d.left as never, top: d.top, width: d.size, height: d.size }}
              contentFit="contain"
            />
          ))}

          <Image source={IMG.title} style={styles.titleImg} contentFit="contain" transition={200} />

          <View style={styles.ticketBadge}>
            <IcCard />
            <Text style={styles.ticketBadgeLabel}> 보유 티켓 </Text>
            <Text style={styles.ticketBadgeCount}>{tickets}</Text>
            <Text style={styles.ticketBadgeLabel}>장</Text>
          </View>

          {/* 휠 */}
          <View style={styles.wheelWrap}>
            <Image source={IMG.coinsLfar} style={[styles.coins, styles.coinsLfar]} contentFit="contain" />
            <Image source={IMG.coinsLnear} style={[styles.coins, styles.coinsLnear]} contentFit="contain" />
            <Image source={IMG.coinsRight} style={[styles.coins, styles.coinsRight]} contentFit="contain" />

            <View style={styles.pointer}>
              <Svg viewBox="0 0 40 40" width={46} height={44}>
                <Path
                  d="M15 2 h10 a3.5 3.5 0 0 1 3.5 3.5 V12 h7 a3 3 0 0 1 2.4 4.8 L22.4 36.6 a3 3 0 0 1 -4.8 0 L2.1 16.8 A3 3 0 0 1 4.5 12 h7 V5.5 A3.5 3.5 0 0 1 15 2z"
                  fill="#1d6ff2"
                  stroke="#1a56c9"
                  strokeWidth={1.8}
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
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
          ) : tickets > 0 ? (
            <Pressable style={[styles.spinBtn, spinning && styles.spinBtnDisabled]} onPress={spin} disabled={spinning}>
              <Text style={styles.spinBtnText}>{spinning ? '돌리는 중...' : '티켓 1장으로 돌리기'}</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.chargeCta} onPress={() => goNativeOrWeb('tickets', '/tickets')}>
              <Text style={styles.chargeCtaText}>🎟️  티켓 충전하고 돌리기</Text>
            </Pressable>
          )}
          {!!errorMsg && <Text style={styles.errorMsg}>{errorMsg}</Text>}

          {feedW && (
            <View style={styles.liveFeed}>
              <Text style={styles.liveFeedText} numberOfLines={1}>
                방금 <Text style={styles.liveFeedName}>{feedW.masked || feedW.name || '회원'}</Text>님이{' '}
                <Text style={styles.liveFeedPrize}>{feedW.prize_label}</Text>에 당첨됐어요
              </Text>
            </View>
          )}
        </View>

        {/* ── 출석 챌린지 ── */}
        <View style={styles.streakSection}>
          <View style={styles.streakBubble}>
            <Text style={styles.streakBubbleText}>7일 출석하면 티켓 +1장!</Text>
          </View>
          <View style={styles.streakBubbleTail} />
          <View style={styles.streakCard}>
            <Text style={styles.streakTitle}>{new Date().getMonth() + 1}월 출석 챌린지 🎉</Text>
            <View style={styles.streakRow}>
              {Array.from({ length: 7 }, (_, i) => {
                const n = i + 1;
                const done = n < streakDays || (n === streakDays && checkedToday);
                const today = !done && (n === streakDays + 1 || (n === streakDays && !checkedToday));
                return (
                  <View
                    key={n}
                    style={[styles.streakCircle, done && styles.streakCircleDone, today && styles.streakCircleToday]}
                  >
                    <Text
                      style={[
                        styles.streakCircleText,
                        done && styles.streakCircleTextDone,
                        today && styles.streakCircleTextToday,
                      ]}
                    >
                      {n}
                    </Text>
                  </View>
                );
              })}
            </View>
            <View style={styles.streakStatusBar}>
              <Text style={styles.streakStatusText}>{streakStatusText}</Text>
            </View>
          </View>
        </View>

        {/* ── 티켓 모으는 방법 ── */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>티켓 모으는 방법</Text>
          </View>
          <View style={styles.missionGrid}>
            <Pressable style={styles.missionCard} onPress={() => goNativeOrWeb('invite', '/invite')}>
              <View style={styles.missionIcon}>
                <IcLoveLetter />
              </View>
              <Text style={styles.missionLabel}>친구초대</Text>
              <View style={[styles.missionPill, styles.missionPillBlue]}>
                <Text style={styles.missionPillTextBlue}>🎟️ +1장</Text>
              </View>
            </Pressable>
            <Pressable style={styles.missionCard} onPress={() => openWeb('/')}>
              <View style={styles.missionIcon}>
                <IcCart />
              </View>
              <Text style={styles.missionLabel}>쇼핑하기</Text>
              <View style={[styles.missionPill, styles.missionPillBlue]}>
                <Text style={styles.missionPillTextBlue}>🎟️ +1장</Text>
              </View>
            </Pressable>
            <Pressable style={styles.missionCard} onPress={() => goNativeOrWeb('tickets', '/tickets')}>
              <View style={styles.missionIcon}>
                <IcTicket />
              </View>
              <Text style={styles.missionLabel}>티켓 충전</Text>
              <View style={styles.missionPill}>
                <Text style={styles.missionPillText}>무료</Text>
              </View>
            </Pressable>
          </View>
        </View>

        {/* ── 내 기록 ── */}
        {history !== null && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>내 기록</Text>
              <Pressable onPress={() => goNativeOrWeb('roulette-history', '/roulette-history')} hitSlop={8}>
                <Text style={styles.historyMore}>전체 기록 보기 →</Text>
              </Pressable>
            </View>
            {history.length === 0 ? (
              <Text style={styles.historyEmpty}>아직 참여 내역이 없어요. 룰렛을 돌려보세요.</Text>
            ) : (
              history.map((s) => {
                const win = s.points_awarded > 0;
                const miss = !win && s.prize_key === 'miss';
                const title = win ? '캐시 당첨!' : miss ? '꽝' : `${s.prize_label || '상품'} 당첨!`;
                return (
                  <View key={s.id} style={styles.historyRow}>
                    <View style={[styles.historyIc, !win && styles.historyIcMuted]}>
                      <IcArrowIn muted={!win} />
                    </View>
                    <View style={styles.historyMain}>
                      <Text style={styles.historyTitle}>{title}</Text>
                      <Text style={styles.historyDate}>{fmtDate(s.created_at)}</Text>
                    </View>
                    {win && <Text style={styles.historyPts}>+{s.points_awarded.toLocaleString('ko-KR')}캐시</Text>}
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>
      <WebBottomNav />

      {/* ── 결과 모달 ── */}
      <Modal visible={result !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, tier === 'big' && styles.modalCardBig]}>
            <View style={styles.modalIcon}>
              {isMiss ? (
                <Image source={IMG.gom} style={styles.modalGom} contentFit="contain" />
              ) : isItem ? (
                <Image source={IMG.mega} style={styles.modalItem} contentFit="contain" />
              ) : (
                <Image source={IMG.cashGift} style={styles.modalCashGift} contentFit="contain" />
              )}
            </View>

            {isMiss && (
              <>
                <Text style={styles.modalTitle}>아쉽게 꽝이에요</Text>
                <Text style={styles.modalSub}>{consolation}</Text>
              </>
            )}
            {isItem && (
              <>
                <Text style={[styles.modalTitle, styles.modalTitleBig]}>{res?.prize_label} 당첨!</Text>
                <Text style={styles.modalSub}>기프티콘이 24시간 내로 발송됩니다.</Text>
              </>
            )}
            {isCash && (
              <>
                <Text style={[styles.modalPoints, tier === 'big' && styles.modalPointsBig]}>
                  +{ptsUp.toLocaleString('ko-KR')}캐시
                </Text>
                <View style={[styles.modalBalance, tier === 'big' && styles.modalBalanceBig]}>
                  <Text style={styles.modalBalanceLabel}>보유캐시</Text>
                  <Text style={styles.modalBalanceVal}>{balUp.toLocaleString('ko-KR')}</Text>
                </View>
              </>
            )}

            <Pressable
              style={styles.modalBtn}
              onPress={() => {
                setResult(null);
                loadAll();
              }}
            >
              <Text style={styles.modalBtnText}>확인</Text>
            </Pressable>
          </View>
        </View>
        <ConfettiBurst burstKey={burst} count={burstCount} />
      </Modal>
    </SafeAreaView>
  );
}

const CENTER = WHEEL_SIZE * 0.284;

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
  scrollContent: { paddingBottom: 32 },

  // Hero
  hero: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 34,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  titleImg: { width: Math.min(SCREEN_W * 0.82, 300), height: Math.min(SCREEN_W * 0.82, 300) * (128.41 / 306.23) },
  ticketBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 13,
    height: 34,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 14,
    shadowColor: '#2563eb',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  ticketBadgeLabel: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  ticketBadgeCount: { fontSize: 15, fontWeight: '900', color: '#1e293b', fontVariant: ['tabular-nums'] },

  wheelWrap: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  coins: { position: 'absolute', zIndex: 3 },
  coinsLfar: { width: 58, height: 58, left: -6, bottom: -16 },
  coinsLnear: { width: 54, height: 54, left: WHEEL_SIZE * 0.13, bottom: -20 },
  coinsRight: { width: 54, height: 54, right: -6, bottom: -8 },
  pointer: {
    position: 'absolute',
    top: -12,
    zIndex: 5,
    width: 46,
    height: 44,
  },
  wheel: { width: WHEEL_SIZE, height: WHEEL_SIZE },
  wheelImg: { width: '100%', height: '100%' },
  startBtn: {
    position: 'absolute',
    width: CENTER,
    height: CENTER,
    borderRadius: CENTER / 2,
    backgroundColor: '#252b3b',
    borderWidth: 5,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  startBtnText: { color: '#ffffff', fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },

  spinBtn: {
    marginTop: 24,
    width: '100%',
    height: 48,
    backgroundColor: '#1370fb',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinBtnDisabled: { backgroundColor: '#c3ccd6' },
  spinBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  chargeCta: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 8,
    shadowColor: '#3182f6',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  chargeCtaText: { color: '#2563eb', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  errorMsg: { marginTop: 12, color: '#dc2626', fontSize: 13, fontWeight: '600' },
  liveFeed: {
    marginTop: 16,
    maxWidth: 340,
    backgroundColor: '#ffffff',
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  liveFeedText: { fontSize: 13, color: '#1e293b' },
  liveFeedName: { color: '#1d4ed8', fontWeight: '700' },
  liveFeedPrize: { color: '#7c3aed', fontWeight: '700' },

  // Streak
  streakSection: { paddingHorizontal: 20, marginTop: 32, alignItems: 'stretch' },
  streakBubble: {
    alignSelf: 'center',
    backgroundColor: '#232936',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  streakBubbleText: { color: '#ffffff', fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  streakBubbleTail: {
    alignSelf: 'center',
    width: 11,
    height: 11,
    backgroundColor: '#232936',
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
    marginTop: -5,
    marginBottom: 10,
    zIndex: -1,
  },
  streakCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eef0f2',
    borderRadius: 20,
    overflow: 'hidden',
    paddingTop: 18,
  },
  streakTitle: { textAlign: 'center', marginBottom: 16, fontSize: 15, fontWeight: '700', color: '#6b7280' },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  streakCircle: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 44,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakCircleToday: { borderColor: '#2563eb' },
  streakCircleDone: { backgroundColor: '#232936', borderColor: '#232936' },
  streakCircleText: { fontSize: 15, fontWeight: '700', color: '#b0b6bf' },
  streakCircleTextToday: { color: '#2563eb' },
  streakCircleTextDone: { color: '#ffffff' },
  streakStatusBar: { backgroundColor: '#2563eb', paddingVertical: 13, alignItems: 'center' },
  streakStatusText: { color: '#ffffff', fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },

  // Sections
  section: { paddingHorizontal: 20, marginTop: 32 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1e293b', letterSpacing: -0.2 },

  // Missions
  missionGrid: { flexDirection: 'row', gap: 10 },
  missionCard: { flex: 1, alignItems: 'center', gap: 10 },
  missionIcon: {
    width: Math.min(SCREEN_W * 0.18, 72),
    height: Math.min(SCREEN_W * 0.18, 72),
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  missionLabel: { fontSize: 14, fontWeight: '700', color: '#1e293b', letterSpacing: -0.2 },
  missionPill: { borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14, backgroundColor: '#f1f3f5' },
  missionPillBlue: { backgroundColor: '#f0f5ff' },
  missionPillText: { fontSize: 13, fontWeight: '800', color: '#6b7280' },
  missionPillTextBlue: { fontSize: 13, fontWeight: '800', color: '#1370fb' },

  // History
  historyMore: { fontSize: 13, fontWeight: '700', color: '#3182f6' },
  historyEmpty: { textAlign: 'center', color: '#64748b', paddingVertical: 24, fontSize: 14 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  historyIc: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyIcMuted: {},
  historyMain: { flex: 1, gap: 3 },
  historyTitle: { fontSize: 15, fontWeight: '800', color: '#191f28', letterSpacing: -0.2 },
  historyDate: { fontSize: 13, color: '#9ca3af' },
  historyPts: { fontSize: 19, fontWeight: '800', color: '#3182f6', letterSpacing: -0.3 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 330,
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingTop: 32,
    paddingBottom: 22,
    paddingHorizontal: 26,
    alignItems: 'center',
  },
  modalCardBig: { backgroundColor: '#fffdf4', borderWidth: 1.5, borderColor: '#f3d177' },
  modalIcon: { minHeight: 96, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  modalGom: { width: 92, height: 92 },
  modalItem: { width: 100, height: 100 },
  modalCashGift: { width: 150, height: 150 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1e293b', textAlign: 'center', letterSpacing: -0.3 },
  modalTitleBig: { color: '#b45309' },
  modalSub: { marginTop: 6, marginBottom: 20, fontSize: 13, color: '#64748b', textAlign: 'center' },
  modalPoints: {
    fontSize: 30,
    fontWeight: '800',
    color: '#1370fb',
    letterSpacing: -0.5,
    marginBottom: 16,
    fontVariant: ['tabular-nums'],
  },
  modalPointsBig: { color: '#eab308' },
  modalBalance: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 7,
    alignSelf: 'stretch',
    marginBottom: 20,
    paddingVertical: 15,
    paddingHorizontal: 14,
    backgroundColor: '#f4f5f7',
    borderRadius: 14,
  },
  modalBalanceBig: { backgroundColor: '#fffaf0' },
  modalBalanceLabel: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  modalBalanceVal: { fontSize: 17, fontWeight: '800', color: '#1e293b', fontVariant: ['tabular-nums'] },
  modalBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#1370fb',
    borderRadius: 8,
    paddingVertical: 15,
    alignItems: 'center',
  },
  modalBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
});
