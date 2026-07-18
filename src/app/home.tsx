import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import WebBottomNav from '@/components/WebBottomNav';
import { apiFetch, ApiError, apiFetchSWR, BASE_URL, isNativeScreenEnabled } from '@/lib/api';
import * as haptics from '@/lib/haptics';
import { markWebStateDirty, requestWebNav } from '@/lib/webNav';

// 웹 홈(/)의 네이티브 구현 1차: 회원 캐시 카드(출석 포함) + 퀵 버튼 +
// 쇼핑몰 목록(검색·카테고리·즐겨찾기). 쇼핑몰 상세(/{slug})와 제휴 클릭(/go/*)은
// 전환 추적을 위해 웹뷰 그대로 쓴다. 히어로(비로그인)·계산기·미션은 웹뷰 유지.

type Shop = {
  name: string;
  slug: string;
  category: string;
  reward?: string;
  note?: string;
  currency?: string;
  logoImg?: string;
};
type Overview = {
  user?: { points?: number; ticket_count?: number };
  checkin?: { checked_today?: boolean; streak?: number };
};

// 웹 shops-data.js CATEGORIES 라벨 순서 그대로 (아이콘은 네이티브 생략)
const CATEGORIES: [key: string, label: string][] = [
  ['mall', '종합쇼핑몰'],
  ['travel', '여행'],
  ['books', '도서/문화'],
  ['digital', 'IT/가전'],
  ['fashion', '패션'],
  ['global', '해외직구'],
  ['food', '식품/건강'],
  ['beauty', '뷰티'],
  ['kids', '유아/아동'],
  ['etc', '기타'],
];

function openWeb(path: string) {
  haptics.tap();
  requestWebNav(path);
  router.dismissTo('/');
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <Svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill={filled ? '#f59e0b' : 'none'}
      stroke={filled ? '#f59e0b' : '#cbd5e1'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="m12 2 2.9 6.05 6.65.95-4.82 4.7 1.14 6.63L12 17.2l-5.87 3.13 1.14-6.63L2.45 9l6.65-.95L12 2Z" />
    </Svg>
  );
}

function SearchIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#8b95a1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={11} cy={11} r={8} />
      <Path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

export default function HomeScreen() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState('mall');
  const [query, setQuery] = useState('');
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [checkinDoneMsg, setCheckinDoneMsg] = useState('');

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      apiFetchSWR<{ shops: Shop[] }>('/api/shops', (d) => {
        if (alive) setShops(d.shops || []);
      }, 30 * 60_000).catch(() => {});
      apiFetchSWR<Overview>('/api/me/overview', (d) => {
        if (alive) setOverview(d);
      }).catch((e) => {
        if (alive && e instanceof ApiError && e.status === 401) router.back();
      });
      apiFetch<{ slugs: string[] }>('/api/favorites')
        .then((d) => {
          if (alive) setFavorites(new Set(d.slugs || []));
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );

  const doCheckin = () => {
    if (checkinBusy) return;
    setCheckinBusy(true);
    haptics.tap();
    apiFetch<{ ok?: boolean; already?: boolean; points?: number; streak?: number }>('/api/checkin', {
      method: 'POST',
    })
      .then((d) => {
        markWebStateDirty();
        setOverview((o) =>
          o
            ? {
                ...o,
                user: { ...o.user, points: Number(o.user?.points || 0) + (d.already ? 0 : Number(d.points || 10)) },
                checkin: { ...o.checkin, checked_today: true, streak: d.streak ?? o.checkin?.streak },
              }
            : o,
        );
        setCheckinDoneMsg(d.already ? '오늘은 이미 출석했어요' : `출석 완료! +${d.points || 10}캐시`);
        haptics.success();
      })
      .catch(() => haptics.error())
      .finally(() => setCheckinBusy(false));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = shops;
    if (q) {
      list = list.filter((s) => s.name.toLowerCase().includes(q) || s.slug.includes(q));
    } else if (category === 'favorites') {
      list = list.filter((s) => favorites.has(s.slug));
    } else {
      list = list.filter((s) => s.category === category);
    }
    return list;
  }, [shops, query, category, favorites]);

  const toggleFavorite = (slug: string) => {
    haptics.tap();
    setFavorites((f) => {
      const next = new Set(f);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
    apiFetch('/api/favorites/toggle', { method: 'POST', body: JSON.stringify({ slug }) }).catch(() => {});
  };

  const points = Number(overview?.user?.points || 0);
  const tickets = Number(overview?.user?.ticket_count || 0);
  const checkedToday = !!overview?.checkin?.checked_today;

  const quickButtons: { label: string; onPress: () => void }[] = [
    {
      label: '룰렛',
      onPress: () => {
        if (isNativeScreenEnabled('roulette')) {
          haptics.tap();
          router.push('/roulette');
        } else openWeb('/roulette');
      },
    },
    { label: '충전소', onPress: () => openWeb('/charge') },
    { label: '캐시상점', onPress: () => openWeb('/store') },
    {
      label: '고객센터',
      onPress: () => {
        if (isNativeScreenEnabled('cs')) {
          haptics.tap();
          router.push('/cs');
        } else openWeb('/cs');
      },
    },
  ];

  const header = (
    <View>
      {/* 상단 로고 */}
      <View style={styles.topBar}>
        <Image
          source={{ uri: encodeURI(BASE_URL + '/static/logos/shoppinglog.webp') }}
          style={styles.logo}
          contentFit="cover"
        />
        <Text style={styles.logoText}>쇼핑로그</Text>
      </View>

      {/* 회원 캐시 카드 */}
      <View style={styles.cashCard}>
        <View style={styles.cashRow}>
          <View style={styles.cashCol}>
            <Text style={styles.cashLabel}>보유 캐시</Text>
            <Pressable
              onPress={() => {
                if (isNativeScreenEnabled('my-purchases')) {
                  haptics.tap();
                  router.push('/my-purchases');
                } else openWeb('/my-purchases');
              }}
            >
              <Text style={styles.cashValue}>
                {overview === null ? '—' : `${points.toLocaleString('ko-KR')}캐시`}
              </Text>
            </Pressable>
          </View>
          <View style={styles.cashDivider} />
          <View style={styles.cashCol}>
            <Text style={styles.cashLabel}>보유 티켓</Text>
            <Text style={styles.cashValue}>{overview === null ? '—' : `${tickets}장`}</Text>
          </View>
        </View>
        {checkinDoneMsg ? (
          <View style={[styles.checkinBtn, styles.checkinBtnDone]}>
            <Text style={styles.checkinDoneText}>{checkinDoneMsg}</Text>
          </View>
        ) : checkedToday ? (
          <View style={[styles.checkinBtn, styles.checkinBtnDone]}>
            <Text style={styles.checkinDoneText}>
              오늘 출석 완료{overview?.checkin?.streak ? ` · ${overview.checkin.streak}일 연속` : ''}
            </Text>
          </View>
        ) : (
          <Pressable
            style={[styles.checkinBtn, checkinBusy && { opacity: 0.6 }]}
            onPress={doCheckin}
            disabled={checkinBusy}
          >
            <Text style={styles.checkinBtnText}>
              {checkinBusy ? '출석 중…' : '출석체크하고 10캐시 받기'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* 퀵 버튼 */}
      <View style={styles.quickRow}>
        {quickButtons.map((b) => (
          <Pressable key={b.label} style={styles.quickBtn} onPress={b.onPress}>
            <Text style={styles.quickBtnText}>{b.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* 검색 */}
      <View style={styles.searchBox}>
        <SearchIcon />
        <TextInput
          style={styles.searchInput}
          placeholder="쇼핑몰 검색..."
          placeholderTextColor="#8b95a1"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {/* 카테고리 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
        <View style={styles.catRow}>
          <Pressable
            style={[styles.catTab, category === 'favorites' && !query && styles.catTabActive]}
            onPress={() => {
              haptics.tap();
              setCategory('favorites');
              setQuery('');
            }}
          >
            <Text style={[styles.catTabText, category === 'favorites' && !query && styles.catTabTextActive]}>
              ★ 즐겨찾기{favorites.size > 0 ? ` ${favorites.size}` : ''}
            </Text>
          </Pressable>
          {CATEGORIES.map(([key, label]) => (
            <Pressable
              key={key}
              style={[styles.catTab, category === key && !query && styles.catTabActive]}
              onPress={() => {
                haptics.tap();
                setCategory(key);
                setQuery('');
              }}
            >
              <Text style={[styles.catTabText, category === key && !query && styles.catTabTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={filtered}
        keyExtractor={(s) => s.slug}
        ListHeaderComponent={header}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {category === 'favorites' && !query
              ? '별을 눌러 자주 가는 쇼핑몰을 모아보세요'
              : '검색 결과가 없어요'}
          </Text>
        }
        renderItem={({ item: s }) => (
          <Pressable
            style={({ pressed }) => [styles.shopRow, pressed && { backgroundColor: '#f8fafc' }]}
            onPress={() => openWeb(`/${s.slug}`)}
          >
            {s.logoImg ? (
              <Image
                source={{ uri: encodeURI(BASE_URL + s.logoImg) }}
                style={styles.shopLogo}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.shopLogo, styles.shopLogoTxt]}>
                <Text style={styles.shopLogoTxtLabel}>{s.name.charAt(0)}</Text>
              </View>
            )}
            <View style={styles.shopInfo}>
              <Text style={styles.shopName} numberOfLines={1}>
                {s.name}
              </Text>
              {!!s.note && (
                <Text style={styles.shopNote} numberOfLines={1}>
                  {s.note}
                </Text>
              )}
            </View>
            <View style={styles.shopRight}>
              {!!s.reward && (
                <Text style={styles.shopReward}>
                  {s.reward}
                  {s.currency === 'point' ? ' P' : ''}
                </Text>
              )}
              <Pressable onPress={() => toggleFavorite(s.slug)} hitSlop={10}>
                <StarIcon filled={favorites.has(s.slug)} />
              </Pressable>
            </View>
          </Pressable>
        )}
      />
      <WebBottomNav active="home" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  logo: { width: 28, height: 28, borderRadius: 8 },
  logoText: { fontSize: 17, fontWeight: '900', color: '#191f28', letterSpacing: -0.3 },
  cashCard: {
    backgroundColor: '#3182f6',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
  },
  cashRow: { flexDirection: 'row', alignItems: 'center' },
  cashCol: { flex: 1 },
  cashDivider: { width: 1, height: 34, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 14 },
  cashLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)', marginBottom: 3 },
  cashValue: { fontSize: 20, fontWeight: '800', color: '#ffffff', letterSpacing: -0.3 },
  checkinBtn: {
    marginTop: 14,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  checkinBtnText: { fontSize: 14, fontWeight: '800', color: '#2272eb' },
  checkinBtnDone: { backgroundColor: 'rgba(255,255,255,0.18)' },
  checkinDoneText: { fontSize: 13.5, fontWeight: '700', color: '#ffffff' },
  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  quickBtn: {
    flex: 1,
    backgroundColor: '#f2f4f6',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  quickBtnText: { fontSize: 13, fontWeight: '700', color: '#333d4b' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f2f4f6',
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: '#191f28' },
  catScroll: { marginBottom: 6 },
  catRow: { flexDirection: 'row', gap: 6, paddingVertical: 4 },
  catTab: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f2f4f6',
  },
  catTabActive: { backgroundColor: '#191f28' },
  catTabText: { fontSize: 13, fontWeight: '700', color: '#4e5968' },
  catTabTextActive: { color: '#ffffff' },
  emptyText: { textAlign: 'center', color: '#8b95a1', fontSize: 13.5, paddingVertical: 36 },
  shopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderRadius: 12,
  },
  shopLogo: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#f2f4f6' },
  shopLogoTxt: { alignItems: 'center', justifyContent: 'center' },
  shopLogoTxtLabel: { fontSize: 16, fontWeight: '800', color: '#3182f6' },
  shopInfo: { flex: 1, minWidth: 0 },
  shopName: { fontSize: 15, fontWeight: '700', color: '#191f28' },
  shopNote: { fontSize: 12.5, color: '#8b95a1', marginTop: 1 },
  shopRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shopReward: { fontSize: 14, fontWeight: '800', color: '#2272eb' },
});
