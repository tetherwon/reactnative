import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { apiFetch, BASE_URL, isNativeScreenEnabled } from '@/lib/api';
import * as haptics from '@/lib/haptics';

// 웹 /benefit(templates/benefit.html)의 네이티브 구현.
// 데이터는 서버 API를 그대로 쓰고, 이미지도 서버 정적 자산을 캐시해 쓴다.

type Overview = { user?: { points?: number } };

// 네이티브 화면 → 웹뷰 페이지로 이동 (index.tsx 의 navUrl 파라미터 수신부와 계약)
function openWeb(path: string) {
  haptics.tap();
  router.navigate({ pathname: '/', params: { navUrl: path, navTs: String(Date.now()) } });
}

const img = (path: string) => ({ uri: encodeURI(BASE_URL + path) });

const ROWS: {
  key: string;
  name: string;
  path: string;
  icon: string;
  pill: string;
  pillBg: string;
  pillColor: string;
}[] = [
  { key: 'tickets', name: '티켓 충전소', path: '/tickets', icon: '/static/ticket.webp', pill: '충전하기', pillBg: '#eff6ff', pillColor: '#2563eb' },
  { key: 'charge', name: '캐시 충전소', path: '/charge', icon: '/static/icons/충전소.webp', pill: '충전하기', pillBg: '#ecfdf5', pillColor: '#059669' },
  { key: 'kospi', name: '코스피 예측', path: '/kospi', icon: '/static/icons/코스피.png', pill: '최대 10캐시', pillBg: '#fef2f2', pillColor: '#dc2626' },
  { key: 'roulette', name: '행운 룰렛', path: '/roulette', icon: '/static/rolutte.webp', pill: '최대 2000캐시', pillBg: '#f5f3ff', pillColor: '#7c3aed' },
  { key: 'tournament', name: '가위바위보', path: '/tournament', icon: '/static/rocksessionpaper.webp', pill: '도전하기', pillBg: '#fff7ed', pillColor: '#ea580c' },
  { key: 'invite', name: '친구 초대', path: '/invite', icon: '/static/icons/친구초대.webp', pill: '300캐시', pillBg: '#fdf2f8', pillColor: '#db2777' },
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
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>혜택</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.subTitle}>즐기고 모으는 적립 혜택</Text>

        {/* 보유 캐시 히어로 → 캐시내역(웹뷰) */}
        <Pressable style={styles.hero} onPress={() => openWeb('/my-purchases')}>
          <View style={styles.heroInfo}>
            <Text style={styles.heroLabel}>보유 캐시</Text>
            <View style={styles.heroValueRow}>
              <Text style={styles.heroValue}>
                {points === null ? '—' : points.toLocaleString('ko-KR')}
              </Text>
              <Text style={styles.heroCoin}>C</Text>
            </View>
            <Text style={styles.heroLink}>캐시내역 ›</Text>
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
  scrollContent: { paddingHorizontal: 18, paddingBottom: 40 },
  subTitle: { fontSize: 14, color: '#64748b', marginBottom: 14 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 18,
    marginBottom: 26,
  },
  heroInfo: { flex: 1 },
  heroLabel: { fontSize: 13, color: '#475569', fontWeight: '600' },
  heroValueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  heroValue: { fontSize: 32, fontWeight: '900', color: '#0f172a', letterSpacing: -0.5 },
  heroCoin: { fontSize: 20, fontWeight: '800', color: '#f59e0b', marginLeft: 4 },
  heroLink: { fontSize: 13, color: '#2563eb', fontWeight: '700', marginTop: 6 },
  heroImg: { width: 104, height: 104 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 10 },
  list: { marginBottom: 22 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
  },
  rowPressed: { opacity: 0.6 },
  rowIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#f4f6fb',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowIcon: { width: 34, height: 34 },
  rowName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#1e293b' },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6 },
  pillText: { fontSize: 12, fontWeight: '800' },
  rowArrow: { fontSize: 20, color: '#cbd5e1', fontWeight: '600' },
  exchange: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  exchangeIcon: { width: 30, height: 30 },
  exchangeText: { flex: 1, fontSize: 13, color: '#475569', lineHeight: 19 },
  exchangeBold: { fontWeight: '900', color: '#b45309' },
});
