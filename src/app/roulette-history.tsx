import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import WebBottomNav from '@/components/WebBottomNav';
import { apiFetch, ApiError } from '@/lib/api';

// 룰렛 전체 기록 (웹 /roulette-history). 웹과 동일 표기: 화살표 아이콘 +
// "캐시 당첨! / 꽝 / OO 당첨!" 제목 + YYYY-MM-DD + 우측 +N캐시. 20개씩 페이징.

type Spin = { id: number; prize_key: string; prize_label: string; points_awarded: number; created_at: number };

const PAGE = 20;

function fmtDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ArrowIn({ muted }: { muted?: boolean }) {
  return (
    <Svg viewBox="0 0 24 24" width={22} height={22}>
      <Path
        d="M17 7 7 17 M15 17 H7 V9"
        fill="none"
        stroke={muted ? '#9ca3af' : '#1370fb'}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export default function RouletteHistoryScreen() {
  const [spins, setSpins] = useState<Spin[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback((offset: number) => {
    return apiFetch<{ spins: Spin[] }>(`/api/roulette/history?limit=${PAGE}&offset=${offset}`).then((d) => {
      const page = d.spins || [];
      setSpins((cur) => (offset === 0 ? page : [...(cur || []), ...page]));
      setHasMore(page.length === PAGE);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPage(0).catch((e) => {
        if (e instanceof ApiError && e.status === 401) router.back();
      });
    }, [loadPage]),
  );

  const loadMore = () => {
    if (loadingMore || !hasMore || spins === null) return;
    setLoadingMore(true);
    loadPage(spins.length)
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>룰렛 전체 기록</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        data={spins || []}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={styles.listContent}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {spins === null ? '불러오는 중...' : '아직 참여 내역이 없어요. 룰렛을 돌려보세요.'}
          </Text>
        }
        ListFooterComponent={loadingMore ? <Text style={styles.empty}>불러오는 중...</Text> : null}
        renderItem={({ item: s }) => {
          const win = s.points_awarded > 0;
          const miss = !win && s.prize_key === 'miss';
          const title = win ? '캐시 당첨!' : miss ? '꽝' : `${s.prize_label || '상품'} 당첨!`;
          return (
            <View style={styles.row}>
              <View style={[styles.ic, !win && styles.icMuted]}>
                <ArrowIn muted={!win} />
              </View>
              <View style={styles.main}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.date}>{fmtDate(s.created_at)}</Text>
              </View>
              {win && <Text style={styles.pts}>+{s.points_awarded.toLocaleString('ko-KR')}캐시</Text>}
            </View>
          );
        }}
      />
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
  listContent: { paddingHorizontal: 18, paddingBottom: 24 },
  empty: { textAlign: 'center', color: '#8b95a1', fontSize: 13.5, paddingVertical: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  ic: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#eaf2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icMuted: { backgroundColor: '#f1f3f5' },
  main: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  date: { fontSize: 12.5, color: '#8b95a1', marginTop: 2 },
  pts: { fontSize: 15, fontWeight: '800', color: '#1370fb' },
});
