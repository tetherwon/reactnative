import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Polyline, Rect } from 'react-native-svg';

import WebBottomNav from '@/components/WebBottomNav';
import { apiFetch, BASE_URL } from '@/lib/api';
import * as haptics from '@/lib/haptics';
import { requestWebNav } from '@/lib/webNav';

// 웹 /discount-log(static/discount-log.js)의 네이티브 구현.
// 몰 이름 기준 그룹핑, 로고 폴백, 코드 복사(완료 상태 전환)까지 웹과 동일.

type Coupon = {
  id: number;
  mall_name: string;
  mall_logo: string;
  mall_link: string;
  title: string;
  period_text: string;
  code: string;
};
type MallGroup = { mall_name: string; mall_logo: string; mall_link: string; coupons: Coupon[] };

// 웹 discount-log.js 의 MERCHANT_LOGO 폴백 그대로
const MERCHANT_LOGO: Record<string, string> = {
  쿠팡: '/static/logos/shops/coupang.png',
  G마켓: '/static/logos/shops/gmarket.webp',
  옥션: '/static/logos/shops/auction.png',
  롯데온: '/static/logos/shops/lotteon.png',
  이마트: '/static/logos/shops/emart.png',
  아고다: '/static/logos/shops/agoda.png',
  Agoda: '/static/logos/shops/agoda.png',
  트립닷컴: '/static/logos/shops/trip.png',
  'Trip.com': '/static/logos/shops/trip.png',
  호텔스닷컴: '/static/logos/shops/hotelscom.svg',
  클룩: '/static/logos/shops/klook.png',
  KLOOK: '/static/logos/shops/klook.png',
  KKday: '/static/logos/shops/kkday.webp',
  알리익스프레스: '/static/logos/shops/aliexpress.png',
  테무: '/static/logos/shops/temu.png',
  아이허브: '/static/logos/shops/iherb.png',
  iHerb: '/static/logos/shops/iherb.png',
  야놀자: '/static/logos/shops/nol.webp',
  NOL: '/static/logos/shops/nol.webp',
  쉬인: '/static/logos/shops/shein.webp',
  SHEIN: '/static/logos/shops/shein.webp',
  W컨셉: '/static/logos/shops/wconcept.webp',
  유데미: '/static/logos/shops/udemy.webp',
  마이리얼트립: '/static/logos/shops/myrealtrip.webp',
  컬리: '/static/logos/shops/kurly.webp',
  마켓컬리: '/static/logos/shops/kurly.webp',
  교보문고: '/static/logos/shops/kyobo.png',
  예스24: '/static/logos/shops/yes24.png',
  YES24: '/static/logos/shops/yes24.png',
};

function kstMonth(): number {
  return new Date(Date.now() + 9 * 3600000).getUTCMonth() + 1;
}

function CopyIcon({ done }: { done: boolean }) {
  return done ? (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="20 6 9 17 4 12" />
    </Svg>
  ) : (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={9} y={9} width={12} height={12} rx={2} />
      <Path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </Svg>
  );
}

export default function DiscountLogScreen() {
  const [groups, setGroups] = useState<MallGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      apiFetch<{ items: Coupon[] }>('/api/discount-coupons')
        .then((d) => {
          if (!alive) return;
          const items = d.items || [];
          // 몰 이름 기준 그룹핑 (첫 등장 순서 유지) — 웹과 동일 로직
          const byMall: Record<string, MallGroup> = {};
          const out: MallGroup[] = [];
          items.forEach((it) => {
            let g = byMall[it.mall_name];
            if (!g) {
              g = { mall_name: it.mall_name, mall_logo: it.mall_logo, mall_link: it.mall_link, coupons: [] };
              byMall[it.mall_name] = g;
              out.push(g);
            }
            if (!g.mall_logo && it.mall_logo) g.mall_logo = it.mall_logo;
            if (!g.mall_link && it.mall_link) g.mall_link = it.mall_link;
            g.coupons.push(it);
          });
          setGroups(out);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
      return () => {
        alive = false;
      };
    }, []),
  );

  const copy = async (c: Coupon) => {
    haptics.tap();
    try {
      await Clipboard.setStringAsync(c.code);
      setCopiedId(c.id);
      setTimeout(() => setCopiedId((cur) => (cur === c.id ? null : cur)), 1600);
    } catch {}
  };

  const openMall = (link: string) => {
    haptics.tap();
    if (/^https?:/i.test(link)) {
      Linking.openURL(link).catch(() => {});
      return;
    }
    // 내부 경로면 웹뷰로 복귀해 해당 페이지 열기
    requestWebNav(link);
    router.dismissTo('/');
  };

  const logoUri = (g: MallGroup): string | null => {
    const logo = g.mall_logo || MERCHANT_LOGO[g.mall_name];
    if (!logo) return null;
    return /^https?:/i.test(logo) ? logo : encodeURI(BASE_URL + logo);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>{kstMonth()}월 할인 쿠폰</Text>
          <Text style={styles.sub}>
            쇼핑로그 적립과 <Text style={styles.subHl}>중복 적용</Text> 가능해요.
          </Text>
        </View>

        {groups === null && !failed && <Text style={styles.loading}>불러오는 중...</Text>}
        {failed && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>쿠폰을 불러오지 못했어요</Text>
          </View>
        )}
        {groups !== null && groups.length === 0 && (
          <View style={styles.empty}>
            <Image
              source={{ uri: encodeURI(BASE_URL + '/static/images/gom/bear-cushion.webp') }}
              style={styles.emptyBear}
              contentFit="contain"
            />
            <Text style={styles.emptyTitle}>지금은 등록된 쿠폰이 없어요</Text>
            <Text style={styles.emptySub}>새 쿠폰이 올라오면 여기에서 알려드릴게요</Text>
          </View>
        )}

        {(groups || []).map((g) => (
          <View key={g.mall_name} style={styles.card}>
            <View style={styles.mallRow}>
              {logoUri(g) ? (
                <View style={styles.logo}>
                  <Image source={{ uri: logoUri(g)! }} style={styles.logoImg} contentFit="cover" />
                </View>
              ) : (
                <View style={[styles.logo, styles.logoText]}>
                  <Text style={styles.logoTextChar}>{(g.mall_name || '?').trim().charAt(0)}</Text>
                </View>
              )}
              <Text style={styles.mallName}>{g.mall_name}</Text>
              {!!g.mall_link && (
                <Pressable onPress={() => openMall(g.mall_link)} hitSlop={8}>
                  <Text style={styles.mallGo}>바로가기 ›</Text>
                </Pressable>
              )}
            </View>
            {g.coupons.map((c) => (
              <View key={c.id} style={styles.coupon}>
                <Text style={styles.couponTitle}>{c.title}</Text>
                {!!c.period_text && <Text style={styles.couponPeriod}>{c.period_text}</Text>}
                <View style={styles.codeRow}>
                  <View style={styles.code}>
                    <Text style={styles.codeText} numberOfLines={1}>
                      {c.code}
                    </Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.copyBtn, pressed && { transform: [{ scale: 0.97 }] }]}
                    onPress={() => copy(c)}
                    disabled={copiedId === c.id}
                  >
                    <CopyIcon done={copiedId === c.id} />
                    <Text style={styles.copyText}>{copiedId === c.id ? '완료' : '복사'}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
      <WebBottomNav active="discount-log" />
    </SafeAreaView>
  );
}

// styles.css .dcp-* 값 그대로
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  header: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '900', color: '#191f28', letterSpacing: -0.5, marginBottom: 8 },
  sub: { fontSize: 14.5, color: '#8b95a1' },
  subHl: { color: '#3182f6', fontWeight: '800' },
  loading: { textAlign: 'center', color: '#8b95a1', paddingVertical: 40, fontSize: 14 },
  empty: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24 },
  emptyBear: { width: 120, height: 120, marginBottom: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#191f28', marginBottom: 4 },
  emptySub: { fontSize: 13, color: '#8b95a1' },
  card: { backgroundColor: '#ffffff', borderTopWidth: 8, borderTopColor: '#f2f4f7' },
  mallRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eef0f4',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImg: { width: '100%', height: '100%' },
  logoText: { backgroundColor: '#eff4ff' },
  logoTextChar: { color: '#3182f6', fontSize: 20, fontWeight: '800' },
  mallName: { flex: 1, fontSize: 17, fontWeight: '800', color: '#191f28' },
  mallGo: { fontSize: 13, fontWeight: '700', color: '#3182f6' },
  coupon: { borderTopWidth: 1, borderTopColor: '#f1f3f6', paddingHorizontal: 16, paddingTop: 13, paddingBottom: 14 },
  couponTitle: { fontSize: 15.5, fontWeight: '800', color: '#191f28', lineHeight: 21, marginBottom: 3 },
  couponPeriod: { fontSize: 13, color: '#a2aab5', marginBottom: 9 },
  codeRow: { flexDirection: 'row', gap: 10 },
  code: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderWidth: 1.6,
    borderStyle: 'dashed',
    borderColor: '#a9c9f5',
    borderRadius: 14,
    backgroundColor: '#eff4ff',
  },
  codeText: { color: '#3182f6', fontSize: 16, fontWeight: '900', letterSpacing: 0.4 },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: '#111827',
    justifyContent: 'center',
  },
  copyText: { color: '#ffffff', fontSize: 14.5, fontWeight: '800' },
});
