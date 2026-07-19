import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';

import WebBottomNav from '@/components/WebBottomNav';
import { ApiError, apiFetchSWR, BASE_URL } from '@/lib/api';
import * as haptics from '@/lib/haptics';

// 웹 /my-purchases(templates/my_purchases.html + my_purchases-inline-1.js)의 네이티브 구현.
// 캐시/포인트 통화 탭, 파란 요약 카드(대기/적립 분할), 날짜 그룹 플랫 원장까지 웹과 동일.

type CashbackItem = {
  merchant_id: string;
  price: number;
  points_awarded: number;
  status: string;
  created_at: number;
};
type PointsEvent = { source: string; label: string; delta: number; created_at: number; logo?: string };
type Overview = {
  user?: { points?: number };
  cashback?: { total_pending?: number; total_confirmed?: number; items?: CashbackItem[] };
  points_history?: { events?: PointsEvent[] };
};
type CoupangHistory = { balance?: number; pending?: number; events?: PointsEvent[] };

type LedgerItem = {
  key: string;
  created_at: number;
  logo: string | null;
  merchant?: string;
  letter: string;
  icon: 'cash' | 'checkin' | 'ticket' | 'point' | null;
  bg: string;
  fg: string;
  title: string;
  meta: string;
  state: string;
  delta: number;
  unit: string;
  status: 'pending' | 'confirmed';
};

// 웹 my_purchases-inline-1.js 의 파스텔 팔레트·해시 그대로
const PALETTE: [string, string][] = [
  ['#eff4ff', '#2563eb'], ['#e8f7ef', '#059669'], ['#fef1f2', '#dc2626'],
  ['#fff7e6', '#b45309'], ['#f3efff', '#7c3aed'], ['#e6f7fb', '#0891b2'],
  ['#fdf2f8', '#be185d'], ['#ecf8ef', '#15803d'],
];
function colorOf(s: string): [string, string] {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// 웹 my_purchases-inline-1.js MERCHANT_TO_SLUG 그대로 (linkprice 코드 → 쇼핑몰 slug)
const MERCHANT_TO_SLUG: Record<string, string> = {
  woori: 'lottehome', applecom: 'apple', ctrip: 'trip', cjbrand: 'cjmarket',
  stories: 'otherstories', charlesnk: 'charleskeith', benetton1: 'benetton',
  ashford1: 'ashford', nordvpn2: 'nordvpn', exvpn: 'expressvpn',
  cappstory: 'appstory', kbbook: 'kyobo', mycredit1: 'nicecredit',
  '60saju': 'saju60', re4akor: 'raileurope',
};

// 상대 경로(/static/...)는 BASE_URL을 붙여 절대 URL로 — RN <Image uri>는 절대 URL만 로드.
// 이게 없어서 서버가 준 뽑기/쇼핑몰 로고(상대경로)가 안 뜨고 회색으로 보였다.
function absLogo(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return encodeURI(BASE_URL + path);
}

// 내역 리스트 최대 높이 — 넘치면 리스트 안에서만 스크롤(페이지가 무한히 길어지지 않게)
const LEDGER_MAX_H = Math.round(Dimensions.get('window').height * 0.52);

// (i) 설명 문구 — 웹 my_purchases-inline-2.js TEXT 와 동일 (강조 태그 제외)
const INFO_TEXT: Record<string, string> = {
  pending:
    '쇼핑몰에서 주문이 확인되어 적립 대기 중인 캐시백이에요. 구매가 취소·반품되지 않고 확정되면(보통 구매한 달의 다다음 달 6~10일경) 적립 캐시백으로 전환돼요.',
  confirmed:
    '구매가 최종 확정되어 적립이 완료된 캐시백이에요. 보유 캐시에 합산되어 상점 교환 등에 사용할 수 있어요.',
  point_pending:
    '쿠팡에서 주문이 확인되어 적립 대기 중인 포인트예요. 구매가 취소·반품되지 않고 확정되면 보유 포인트로 전환돼요.',
  point_confirmed:
    '구매가 최종 확정되어 적립이 완료된 포인트예요. 보유 포인트에 합산되어 포인트 뽑기에 사용할 수 있어요.',
};

function fmtGroupDate(ts: number): string {
  const d = new Date((ts || 0) * 1000);
  const now = new Date();
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}년 ${md}`;
}

function cleanLabel(label: string): string {
  const t = String(label || '').split('(')[0].split(':')[0].trim();
  return t || label;
}

function AvatarIcon({ icon, color }: { icon: NonNullable<LedgerItem['icon']>; color: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (icon) {
    case 'checkin':
      return (
        <Svg {...common}>
          <Rect x={3} y={4} width={18} height={18} rx={2} />
          <Line x1={16} y1={2} x2={16} y2={6} />
          <Line x1={8} y1={2} x2={8} y2={6} />
          <Line x1={3} y1={10} x2={21} y2={10} />
          <Path d="m9 16 2 2 4-4" />
        </Svg>
      );
    case 'ticket':
      return (
        <Svg {...common}>
          <Path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z" />
          <Path d="M13 5v14" />
        </Svg>
      );
    case 'point':
      return (
        <Svg {...common}>
          <Circle cx={12} cy={12} r={9} />
          <Path d="M9.5 15.5V8.5h3a2.4 2.4 0 0 1 0 4.8h-3" />
        </Svg>
      );
    case 'cash':
      return (
        <Svg {...common}>
          <Circle cx={12} cy={12} r={9} />
          <Path d="M7.5 9.5h9M7.5 13h9M9 9l3 6 3-6" />
        </Svg>
      );
  }
}

function ClockIco({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 7v5l3 2" />
    </Svg>
  );
}
function CoinsIco({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Ellipse cx={12} cy={6} rx={8} ry={3} />
      <Path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-12" />
    </Svg>
  );
}

export default function MyPurchasesScreen() {
  const [cur, setCur] = useState<'cash' | 'point'>('cash');
  const [balance, setBalance] = useState(0);
  const [cashPending, setCashPending] = useState(0);
  const [cashItems, setCashItems] = useState<LedgerItem[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed'>('all');
  const [pointBalance, setPointBalance] = useState(0);
  const [pointPending, setPointPending] = useState(0);
  const [pointItems, setPointItems] = useState<LedgerItem[] | null>(null);
  const [infoKey, setInfoKey] = useState<string | null>(null);
  // slug → logoImg (쇼핑몰 로고 해석용). /api/shops SWR 캐시.
  const [shopLogos, setShopLogos] = useState<Record<string, string>>({});

  // merchant_id → 쇼핑몰 로고(절대 URL). 웹 resolveShop 과 동일 규칙(코드→slug 매핑 포함).
  const resolveShopLogo = useCallback(
    (mid?: string | null): string | null => {
      if (!mid) return null;
      const key = String(mid).toLowerCase();
      const slug = MERCHANT_TO_SLUG[key] || key;
      return absLogo(shopLogos[slug] || null);
    },
    [shopLogos],
  );

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      apiFetchSWR<{ shops?: { slug?: string; logoImg?: string }[] }>('/api/shops', (d) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        (d.shops || []).forEach((s) => {
          if (s.slug && s.logoImg) map[s.slug] = s.logoImg;
        });
        setShopLogos(map);
      }).catch(() => {});
      apiFetchSWR<Overview>('/api/me/overview', (d) => {
        if (!alive) return;
        const basePoints = Number(d.user?.points || 0);
        setBalance(basePoints);
        setCashPending(Number(d.cashback?.total_pending || 0));
        const items: LedgerItem[] = [];
        (d.cashback?.items || []).forEach((it, i) => {
          const shop = it.merchant_id || '-';
          const [bg, fg] = colorOf(shop);
          items.push({
            key: `cb-${i}-${it.created_at}`,
            created_at: Number(it.created_at || 0),
            logo: null,
            merchant: shop,
            letter: shop.charAt(0).toUpperCase(),
            icon: null,
            bg,
            fg,
            title: shop,
            meta: `쇼핑 적립 · ${Number(it.price || 0).toLocaleString('ko-KR')}원`,
            state: it.status === 'confirmed' ? '' : '적립 대기',
            delta: Number(it.points_awarded || 0),
            unit: '캐시',
            status: it.status === 'confirmed' ? 'confirmed' : 'pending',
          });
        });
        (d.points_history?.events || []).forEach((ev, i) => {
          let icon: LedgerItem['icon'] = 'cash';
          let bg = '#fff7e6';
          let fg = '#f59e0b';
          let logo: string | null = null;
          let title = cleanLabel(ev.label || '캐시 적립');
          if (ev.source === 'checkin') {
            icon = 'checkin'; bg = '#e8f7ef'; fg = '#00a661';
          } else if (ev.source === 'roulette') {
            logo = encodeURI(BASE_URL + '/static/rolutte.webp');
            title = '행운룰렛';
            icon = null;
          } else if (ev.source === 'admin' && (ev.label || '').includes('티켓')) {
            icon = 'ticket'; bg = '#eff4ff'; fg = '#2563eb';
          }
          items.push({
            key: `ph-${i}-${ev.created_at}`,
            created_at: Number(ev.created_at || 0),
            logo,
            letter: '',
            icon,
            bg,
            fg,
            title,
            meta: '',
            state: '',
            delta: Number(ev.delta || 0),
            unit: '캐시',
            status: 'confirmed',
          });
        });
        items.sort((a, b) => b.created_at - a.created_at);
        setCashItems(items);
      }).catch((e) => {
        if (alive && e instanceof ApiError && e.status === 401) router.back();
      });
      apiFetchSWR<CoupangHistory>('/api/coupang-points/history', (d) => {
        if (!alive) return;
        setPointBalance(Number(d.balance || 0));
        setPointPending(Number(d.pending || 0));
        const items: LedgerItem[] = (d.events || []).map((ev, i) => {
          const delta = Number(ev.delta || 0);
          const isDraw = ev.source === 'draw';
          return {
            key: `pt-${i}-${ev.created_at}`,
            created_at: Number(ev.created_at || 0),
            logo: absLogo(ev.logo),
            letter: '',
            icon: 'point',
            bg: isDraw ? '#fff3e8' : delta < 0 ? '#fef1f2' : '#f3efff',
            fg: isDraw ? '#e0863b' : delta < 0 ? '#dc2626' : '#7c3aed',
            title: cleanLabel(ev.label || '포인트'),
            meta: '',
            state: '',
            delta,
            unit: 'P',
            status: 'confirmed',
          };
        });
        setPointItems(items);
      }).catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );

  const shownCash = (cashItems || []).filter((it) => filter === 'all' || it.status === filter);
  const nPending = (cashItems || []).filter((it) => it.status === 'pending').length;
  const nAll = (cashItems || []).length;

  const renderLedger = (items: LedgerItem[], emptyTitle: string, emptySub: string) => {
    if (!items.length) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptySub}>{emptySub}</Text>
        </View>
      );
    }
    let lastKey = '';
    return (
      <ScrollView
        style={styles.ledgerScroll}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        {items.map((it) => {
      const groupKey = fmtGroupDate(it.created_at);
      const showHead = groupKey !== lastKey;
      lastKey = groupKey;
      const logoUri = it.logo || resolveShopLogo(it.merchant);
      return (
        <View key={it.key}>
          {showHead && <Text style={styles.dateHead}>{groupKey}</Text>}
          <View style={styles.item}>
            {logoUri ? (
              <View style={[styles.avatar, styles.avatarLogo]}>
                <Image source={{ uri: logoUri }} style={styles.avatarImg} contentFit="contain" />
              </View>
            ) : (
              <View style={[styles.avatar, { backgroundColor: it.bg }]}>
                {it.icon ? (
                  <AvatarIcon icon={it.icon} color={it.fg} />
                ) : (
                  <Text style={[styles.avatarLetter, { color: it.fg }]}>{it.letter}</Text>
                )}
              </View>
            )}
            <View style={styles.itemInfo}>
              <Text style={styles.itemTitle} numberOfLines={1}>
                {it.title}
              </Text>
              {!!it.meta && <Text style={styles.itemMeta}>{it.meta}</Text>}
            </View>
            <View style={styles.itemRight}>
              <Text style={[styles.itemDelta, it.delta < 0 && styles.itemDeltaMinus]}>
                {it.delta < 0 ? '' : '+'}
                {it.delta.toLocaleString('ko-KR')}
                {it.unit}
              </Text>
              {!!it.state && <Text style={styles.itemState}>{it.state}</Text>}
            </View>
          </View>
        </View>
      );
        })}
      </ScrollView>
    );
  };

  const summary = (
    isPoint: boolean,
    label: string,
    amount: number,
    pending: number,
    confirmed: number,
    keys: [string, string],
  ) => (
    <View style={styles.summary}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <View style={styles.summaryAmountRow}>
        <Text style={styles.summaryAmount}>{amount.toLocaleString('ko-KR')}</Text>
        <View style={[styles.summaryCoin, isPoint && styles.summaryCoinPoint]}>
          <Text style={[styles.summaryCoinText, isPoint && styles.summaryCoinTextPoint]}>
            {isPoint ? 'P' : 'C'}
          </Text>
        </View>
      </View>
      <View style={styles.split}>
        <Pressable
          style={styles.splitItem}
          onPress={() => setInfoKey((k) => (k === keys[0] ? null : keys[0]))}
        >
          <View style={styles.splitLabelRow}>
            <ClockIco color="#6366f1" />
            <Text style={styles.splitLabel}>대기 {isPoint ? '포인트' : '캐시'}</Text>
            <Text style={styles.infoMark}>ⓘ</Text>
          </View>
          <Text style={styles.splitValue}>
            {pending.toLocaleString('ko-KR')}
            {isPoint ? 'P' : '캐시'}
          </Text>
        </Pressable>
        <View style={styles.splitDivider} />
        <Pressable
          style={styles.splitItem}
          onPress={() => setInfoKey((k) => (k === keys[1] ? null : keys[1]))}
        >
          <View style={styles.splitLabelRow}>
            <CoinsIco color="#2563eb" />
            <Text style={styles.splitLabel}>적립 {isPoint ? '포인트' : '캐시'}</Text>
            <Text style={styles.infoMark}>ⓘ</Text>
          </View>
          <Text style={styles.splitValue}>
            {confirmed.toLocaleString('ko-KR')}
            {isPoint ? 'P' : '캐시'}
          </Text>
        </Pressable>
      </View>
      {infoKey !== null && keys.includes(infoKey) && (
        <View style={styles.infoPop}>
          <Text style={styles.infoPopText}>{INFO_TEXT[infoKey]}</Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.headTitle}>캐시 내역</Text>
        <Text style={styles.headSub}>제휴 링크로 구매하면 자동 적립</Text>

        {/* 캐시/포인트 통화 탭 */}
        <View style={styles.curTabs}>
          {(['cash', 'point'] as const).map((c) => (
            <Pressable
              key={c}
              style={[styles.curTab, cur === c && styles.curTabActive]}
              onPress={() => {
                haptics.tap();
                setCur(c);
                setInfoKey(null);
              }}
            >
              <Text style={[styles.curTabText, cur === c && styles.curTabTextActive]}>
                {c === 'cash' ? '캐시 내역' : '포인트 내역'}
              </Text>
            </Pressable>
          ))}
        </View>

        {cur === 'cash' ? (
          <>
            {summary(false, '내 캐시', balance, cashPending, balance, ['pending', 'confirmed'])}
            <View style={styles.listHead}>
              <Text style={styles.listHeadTitle}>캐시 적립 내역</Text>
            </View>
            {nAll > 0 && (
              <View style={styles.filterTabs}>
                {(
                  [
                    ['all', '전체', nAll],
                    ['pending', '적립 대기', nPending],
                    ['confirmed', '확정', nAll - nPending],
                  ] as const
                ).map(([f, label, n]) => (
                  <Pressable
                    key={f}
                    style={[styles.filterTab, filter === f && styles.filterTabActive]}
                    onPress={() => {
                      haptics.tap();
                      setFilter(f);
                    }}
                  >
                    <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
                      {label} {n}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {cashItems === null ? (
              <Text style={styles.loading}>불러오는 중...</Text>
            ) : (
              renderLedger(
                shownCash,
                filter === 'pending' ? '적립 대기 중인 캐시가 없어요' : '아직 적립 내역이 없어요',
                '룰렛을 돌리거나 즐겨찾는 쇼핑몰을 구경해보세요',
              )
            )}
          </>
        ) : (
          <>
            {summary(true, '보유 포인트', pointBalance, pointPending, pointBalance, [
              'point_pending',
              'point_confirmed',
            ])}
            <View style={styles.listHead}>
              <Text style={styles.listHeadTitle}>포인트 내역</Text>
            </View>
            {pointItems === null ? (
              <Text style={styles.loading}>불러오는 중...</Text>
            ) : (
              renderLedger(pointItems, '아직 포인트 내역이 없어요', '쿠팡에서 적립하면 여기에 표시돼요')
            )}
          </>
        )}
      </ScrollView>
      <WebBottomNav />
    </SafeAreaView>
  );
}

// styles.css .cash-* 값 그대로
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
  headTitle: { fontSize: 22, fontWeight: '800', color: '#191f28', letterSpacing: -0.3, marginBottom: 4 },
  headSub: { fontSize: 12, color: '#8b95a1', marginBottom: 16 },
  curTabs: { flexDirection: 'row', gap: 6, backgroundColor: '#eef0f3', borderRadius: 12, padding: 4, marginBottom: 16 },
  curTab: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  curTabActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  curTabText: { fontSize: 14, fontWeight: '700', color: '#8b95a1' },
  curTabTextActive: { color: '#191f28' },
  summary: {
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    marginBottom: 14,
    backgroundColor: '#3182f6',
    shadowColor: '#3182f6',
    shadowOpacity: 0.32,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  summaryLabel: { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  summaryAmountRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  summaryAmount: { fontSize: 44, fontWeight: '800', color: '#ffffff', letterSpacing: -0.9, lineHeight: 48 },
  summaryCoin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f4c22e',
    borderWidth: 3,
    borderColor: '#f9dd7b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCoinPoint: { backgroundColor: '#2f6be6', borderColor: '#83aaf3' },
  summaryCoinText: { fontSize: 17, fontWeight: '800', color: '#ffffff' },
  summaryCoinTextPoint: { color: '#ffffff' },
  split: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginTop: 16,
    shadowColor: '#0f172a',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  splitItem: { flex: 1, paddingLeft: 6, gap: 3 },
  splitLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  splitLabel: { fontSize: 12, fontWeight: '700', color: '#4e5968' },
  infoMark: { fontSize: 12, color: '#8b95a1' },
  splitValue: { fontSize: 16, fontWeight: '800', color: '#191f28' },
  splitDivider: { width: 1, backgroundColor: '#eef0f3', marginHorizontal: 4 },
  infoPop: { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 10, padding: 12, marginTop: 10 },
  infoPopText: { fontSize: 12.5, color: '#334155', lineHeight: 19 },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 },
  listHeadTitle: { fontSize: 16, fontWeight: '800', color: '#191f28' },
  filterTabs: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  filterTab: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#e5e8eb',
    borderRadius: 999,
    backgroundColor: '#ffffff',
  },
  filterTabActive: { backgroundColor: '#3182f6', borderColor: '#3182f6' },
  filterTabText: { fontSize: 12, fontWeight: '700', color: '#8b95a1' },
  filterTabTextActive: { color: '#ffffff' },
  loading: { textAlign: 'center', color: '#8b95a1', paddingVertical: 40, fontSize: 14 },
  ledgerScroll: { maxHeight: LEDGER_MAX_H },
  dateHead: { fontSize: 12.5, fontWeight: '600', color: '#a2aab5', paddingTop: 14, paddingBottom: 4, paddingHorizontal: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 2 },
  avatar: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarLogo: { backgroundColor: '#f2f4f6', overflow: 'hidden' },
  avatarImg: { width: 28, height: 28 },
  avatarLetter: { fontSize: 15, fontWeight: '800' },
  itemInfo: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 14.5, fontWeight: '600', color: '#333d4b' },
  itemMeta: { fontSize: 12.5, color: '#8b95a1', marginTop: 1 },
  itemRight: { alignItems: 'flex-end', gap: 1 },
  itemDelta: { fontSize: 15.5, fontWeight: '800', color: '#191f28' },
  itemDeltaMinus: { color: '#e42939' },
  itemState: { fontSize: 12, fontWeight: '600', color: '#d97706' },
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#4e5968', marginBottom: 4 },
  emptySub: { fontSize: 13, color: '#8b95a1' },
});
