import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import WebBottomNav from '@/components/WebBottomNav';
import { apiFetch, ApiError, apiFetchSWR, BASE_URL, isNativeScreenEnabled } from '@/lib/api';
import * as haptics from '@/lib/haptics';
import { markWebStateDirty, requestWebNav } from '@/lib/webNav';

// 웹 /tickets(templates/tickets.html + static/ticket-purchase.js)의 네이티브 구현.
// 티켓 유료 구매는 폐지 — 미션(친구초대·쇼핑 보상·쇼핑몰 구경)으로만 획득.

type Overview = { user?: { ticket_count?: number } };

function openWeb(path: string) {
  haptics.tap();
  requestWebNav(path);
  router.dismissTo('/');
}

function MissionIcon({ kind }: { kind: 'invite' | 'shop' | 'browse' }) {
  const stroke = { invite: '#db2777', shop: '#059669', browse: '#2563eb' }[kind];
  const common = {
    width: 26,
    height: 26,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (kind) {
    case 'invite':
      return (
        <Svg {...common}>
          <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <Circle cx={9} cy={7} r={4} />
          <Line x1={19} y1={8} x2={19} y2={14} />
          <Line x1={22} y1={11} x2={16} y2={11} />
        </Svg>
      );
    case 'shop':
      return (
        <Svg {...common}>
          <Path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <Line x1={3} y1={6} x2={21} y2={6} />
          <Path d="M16 10a4 4 0 0 1-8 0" />
        </Svg>
      );
    case 'browse':
      return (
        <Svg {...common}>
          <Path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
          <Circle cx={12} cy={12} r={3} />
        </Svg>
      );
  }
}

export default function TicketsScreen() {
  const [tickets, setTickets] = useState<number | null>(null);
  const [browseClaimed, setBrowseClaimed] = useState(false);
  const [browseBusy, setBrowseBusy] = useState(false);
  const [toast, setToast] = useState('');

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      apiFetchSWR<Overview>('/api/me/overview', (d) => {
        if (alive && d.user) setTickets(Number(d.user.ticket_count || 0));
      }).catch((e) => {
        if (alive && e instanceof ApiError && e.status === 401) router.back();
      });
      apiFetch<{ claimed_today?: boolean }>('/api/mission/browse-ticket/status')
        .then((d) => {
          if (alive) setBrowseClaimed(!!d.claimed_today);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );

  // 쇼핑몰 구경: 티켓 지급(하루 1회) 후 쿠팡으로 이동 (웹 흐름 그대로 —
  // /go/coupang 은 제휴 클릭 기록을 위해 웹뷰 경유)
  const doBrowse = () => {
    if (browseBusy) return;
    haptics.tap();
    setBrowseBusy(true);
    apiFetch<{ ok?: boolean; ticket_count?: number }>('/api/mission/browse-ticket', { method: 'POST' })
      .then((d) => {
        markWebStateDirty();
        setBrowseClaimed(true);
        if (d.ticket_count != null) setTickets(Number(d.ticket_count));
        setToast('티켓 +1장! 쿠팡으로 이동해요');
        haptics.success();
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 409) setBrowseClaimed(true);
      })
      .finally(() => {
        setBrowseBusy(false);
        setTimeout(() => {
          setToast('');
          openWeb('/go/coupang');
        }, 700);
      });
  };

  const missionCard = (
    icon: React.ReactNode,
    iconBg: string,
    title: string,
    desc: string,
    pill: string,
    onPress: () => void,
    done = false,
  ) => (
    <Pressable
      key={title}
      style={({ pressed }) => [styles.card, done && { opacity: 0.55 }, pressed && !done && styles.cardPressed]}
      onPress={onPress}
      disabled={done}
    >
      <View style={[styles.cardIcon, { backgroundColor: iconBg }]}>{icon}</View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardDesc}>{desc}</Text>
      </View>
      <View style={[styles.cardPill, done && styles.cardPillDone]}>
        <Text style={[styles.cardPillText, done && styles.cardPillTextDone]}>{pill}</Text>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>티켓 충전소</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 히어로: 보유 티켓 */}
        <View style={styles.hero}>
          <View style={styles.heroText}>
            <Text style={styles.heroLabel}>보유 티켓</Text>
            <Text style={styles.heroCount}>
              {tickets === null ? '—' : `${tickets.toLocaleString('ko-KR')}장`}
            </Text>
          </View>
          <Image
            source={{ uri: encodeURI(BASE_URL + '/static/buyticket.webp') }}
            style={styles.heroImg}
            contentFit="contain"
          />
        </View>

        {/* 티켓 모으는 방법 */}
        <Text style={styles.sectionTitle}>티켓 모으는 방법</Text>
        <View style={styles.cardList}>
          {missionCard(
            <MissionIcon kind="invite" />,
            '#fdf2f8',
            '친구초대',
            '친구가 가입하면 지급',
            '+1장',
            () => {
              if (isNativeScreenEnabled('invite')) {
                haptics.tap();
                router.push('/invite');
              } else openWeb('/invite');
            },
          )}
          {missionCard(
            <MissionIcon kind="shop" />,
            '#e8f7ef',
            '쇼핑 보상',
            '제휴몰에서 쇼핑하면 지급',
            '+1장',
            () => {
              if (isNativeScreenEnabled('home')) {
                haptics.tap();
                router.push('/home');
              } else openWeb('/');
            },
          )}
          {missionCard(
            <MissionIcon kind="browse" />,
            '#eff4ff',
            '쇼핑몰 구경',
            '쿠팡 구경 · 하루 1회',
            browseBusy ? '지급 중…' : browseClaimed ? '내일 또!' : '+1장',
            doBrowse,
            browseClaimed,
          )}
        </View>

        {!!toast && <Text style={styles.toast}>{toast}</Text>}

        {/* 이용 안내 */}
        <Text style={styles.noticeTitle}>이용 안내</Text>
        <View style={styles.noticeList}>
          <Text style={styles.noticeItem}>
            · 티켓은 친구초대·쇼핑 보상·쇼핑몰 구경 등 미션으로만 모을 수 있어요.
          </Text>
          <Text style={styles.noticeItem}>
            · 티켓은 쇼핑로그 내 룰렛, 가위바위보 참여에만 사용할 수 있어요.
          </Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#eff4ff',
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 18,
    marginBottom: 20,
  },
  heroText: { flex: 1 },
  heroLabel: { fontSize: 13, fontWeight: '700', color: '#4e5968' },
  heroCount: { fontSize: 30, fontWeight: '900', color: '#191f28', marginTop: 4, letterSpacing: -0.5 },
  heroImg: { width: 96, height: 96 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#191f28', marginBottom: 10 },
  cardList: { gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eef0f4',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  cardPressed: { backgroundColor: '#f8fafc' },
  cardIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#191f28' },
  cardDesc: { fontSize: 12.5, color: '#8b95a1', marginTop: 2 },
  cardPill: {
    backgroundColor: '#3182f6',
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  cardPillDone: { backgroundColor: '#f2f4f6' },
  cardPillText: { fontSize: 12.5, fontWeight: '800', color: '#ffffff' },
  cardPillTextDone: { color: '#94a3b8' },
  toast: { textAlign: 'center', color: '#059669', fontSize: 13.5, fontWeight: '700', marginTop: 12 },
  noticeTitle: { fontSize: 14, fontWeight: '800', color: '#4e5968', marginTop: 24, marginBottom: 8 },
  noticeList: { gap: 5 },
  noticeItem: { fontSize: 12.5, color: '#8b95a1', lineHeight: 19 },
});
