import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import WebBottomNav from '@/components/WebBottomNav';
import { apiFetch, BASE_URL, isNativeScreenEnabled } from '@/lib/api';
import * as haptics from '@/lib/haptics';

// 웹 /benefit(templates/benefit.html)의 네이티브 구현.
// 색·크기·간격은 static/styles.css 의 benefit-* 값을 그대로 옮겼다 (픽셀 패리티).

type Overview = { user?: { points?: number } };

function openWeb(path: string) {
  haptics.tap();
  router.navigate({ pathname: '/', params: { navUrl: path, navTs: String(Date.now()) } });
}

const img = (path: string) => ({ uri: encodeURI(BASE_URL + path) });

// styles.css .benefit-row-pill--* 값 그대로
const ROWS: {
  key: string;
  name: string;
  path: string;
  icon: string;
  pill: string;
  pillBg: string;
  pillColor: string;
}[] = [
  { key: 'tickets', name: '티켓 충전소', path: '/tickets', icon: '/static/ticket.webp', pill: '충전하기', pillBg: '#eff4ff', pillColor: '#3182f6' },
  { key: 'charge', name: '캐시 충전소', path: '/charge', icon: '/static/icons/충전소.webp', pill: '충전하기', pillBg: '#e6f7ef', pillColor: '#03b26c' },
  { key: 'kospi', name: '코스피 예측', path: '/kospi', icon: '/static/icons/코스피.png', pill: '최대 10캐시', pillBg: '#fdecee', pillColor: '#e42939' },
  { key: 'roulette', name: '행운 룰렛', path: '/roulette', icon: '/static/rolutte.webp', pill: '최대 2000캐시', pillBg: '#f1ebfe', pillColor: '#7c3aed' },
  { key: 'tournament', name: '가위바위보', path: '/tournament', icon: '/static/rocksessionpaper.webp', pill: '도전하기', pillBg: '#fff1e3', pillColor: '#e2620a' },
  { key: 'invite', name: '친구 초대', path: '/invite', icon: '/static/icons/친구초대.webp', pill: '300캐시', pillBg: '#fdecf4', pillColor: '#db2777' },
];

export default function BenefitScreen() {
  const [points, setPoints] = useState<number | null>(null);

  // 웹뷰/룰렛에서 돌아올 때마다 잔액 갱신 (출석·뽑기 등으로 바뀔 수 있음)
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      apiFetch<Overview>('/api/me/overview')
        .then((d) => {
          if (alive && d.user) setPoints(Number(d.user.points || 0));
        })
        .catch(() => {
          // 401 등 — 웹뷰로 돌아가 웹의 게스트 흐름을 따르게 한다
          if (alive) router.back();
        });
      return () => {
        alive = false;
      };
    }, []),
  );

  const onRowPress = (row: (typeof ROWS)[number]) => {
    if (row.key === 'roulette' && isNativeScreenEnabled('roulette')) {
      haptics.tap();
      router.push('/roulette');
      return;
    }
    openWeb(row.path);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* benefit-head */}
        <Text style={styles.headTitle}>혜택</Text>
        <Text style={styles.headSub}>즐기고 모으는 적립 혜택</Text>

        {/* benefit-hero: 파란 배경 + 보유 캐시 + 이글루 (탭 → 캐시내역) */}
        <Pressable style={styles.hero} onPress={() => openWeb('/my-purchases')}>
          <View style={styles.heroInfo}>
            <Text style={styles.heroLabel}>보유 캐시</Text>
            <View style={styles.heroValueRow}>
              <Text style={styles.heroValue}>
                {points === null ? '—' : points.toLocaleString('ko-KR')}
              </Text>
              <View style={styles.heroCoin}>
                <Text style={styles.heroCoinText}>C</Text>
              </View>
            </View>
            <View style={styles.heroLink}>
              <Text style={styles.heroLinkText}>캐시내역 ›</Text>
            </View>
          </View>
          <Image source={img('/static/logos/이글루.webp')} style={styles.heroImg} contentFit="contain" />
        </Pressable>

        {/* 적립하기 리스트 */}
        <Text style={styles.sectionTitle}>적립하고 캐시 받기</Text>
        <View style={styles.list}>
          {ROWS.map((row) => (
            <Pressable
              key={row.key}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => onRowPress(row)}
            >
              <View style={styles.rowIconWrap}>
                <Image source={img(row.icon)} style={styles.rowIcon} contentFit="contain" />
              </View>
              <Text style={styles.rowName}>{row.name}</Text>
              <View style={[styles.pill, { backgroundColor: row.pillBg }]}>
                <Text style={[styles.pillText, { color: row.pillColor }]}>{row.pill}</Text>
              </View>
              <Text style={styles.rowArrow}>›</Text>
            </Pressable>
          ))}
        </View>

        {/* 캐시상점 배너 */}
        <Pressable style={styles.exchange} onPress={() => openWeb('/store')}>
          <Image source={img('/static/logos/트로피.webp')} style={styles.exchangeIcon} contentFit="contain" />
          <Text style={styles.exchangeText}>
            모은 캐시는 <Text style={styles.exchangeBold}>캐시상점</Text>에서 상품권·기프티콘으로
            교환할 수 있어요.
          </Text>
          <Text style={styles.rowArrow}>›</Text>
        </Pressable>
      </ScrollView>
      <WebBottomNav active="benefit" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 32 },
  headTitle: { fontSize: 22, fontWeight: '800', color: '#191f28', letterSpacing: -0.3, marginBottom: 4 },
  headSub: { fontSize: 12, color: '#8b95a1', marginBottom: 16 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#3182f6',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 20,
    marginBottom: 14,
    shadowColor: '#3182f6',
    shadowOpacity: 0.32,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  heroInfo: { flex: 1 },
  heroLabel: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.85)', marginBottom: 6 },
  heroValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroValue: { fontSize: 36, fontWeight: '800', color: '#ffffff', letterSpacing: -0.7, lineHeight: 40 },
  heroCoin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#fe9800',
    borderWidth: 2,
    borderColor: '#fde68a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCoinText: { fontSize: 16, fontWeight: '800', color: '#92400e' },
  heroLink: {
    alignSelf: 'flex-start',
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroLinkText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  heroImg: { width: 96, height: 96, transform: [{ translateX: 10 }] },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#191f28', marginTop: 12, marginBottom: 8 },
  list: { marginBottom: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 14,
  },
  rowPressed: { backgroundColor: '#f2f4f6' },
  rowIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#f4f6fb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIcon: { width: 30, height: 30 },
  rowName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#191f28' },
  pill: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  pillText: { fontSize: 12, fontWeight: '700' },
  rowArrow: { fontSize: 20, color: '#d1d6db', fontWeight: '600' },
  exchange: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fffbeb',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  exchangeIcon: { width: 30, height: 30 },
  exchangeText: { flex: 1, fontSize: 13, color: '#475569', lineHeight: 19 },
  exchangeBold: { fontWeight: '900', color: '#b45309' },
});
