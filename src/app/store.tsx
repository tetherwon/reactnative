import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import WebBottomNav from '@/components/WebBottomNav';
import { requestWebNav } from '@/lib/webNav';
import { ApiError, apiFetch, apiFetchSWR, BASE_URL } from '@/lib/api';
import * as haptics from '@/lib/haptics';

// 웹 /store(templates/store.html + store-inline-1.js + store-catalog.js)의 네이티브 구현.
// 관리자 기프티쇼 카탈로그(/api/store/catalog)를 브랜드 타일→상품→구매 시트로 렌더.
// 구매(POST /api/store/purchase)는 웹과 동일: 한 번 더 눌러 확정 · 발급 실패 자동 환급.

type CatalogItem = {
  name: string;
  brand: string;
  category?: string;
  image_url?: string;
  cash_price: number;
  usage_text?: string;
  terms_text?: string;
};

const DEFAULT_USAGE = '구매 완료 후 발급된 코드를 해당 브랜드 앱 또는 매장에서 사용하세요.';
const DEFAULT_TERMS = '• 발급 후 유효기간 내 사용 필수\n• 본인 계정에만 사용 가능\n• 교환 및 환불 불가';

// 브랜드 로고(BI) — 웹 store-inline-1.js BRAND_LOGOS 그대로. svg는 RN에서 안 떠서 제외.
const BRAND_LOGOS: Record<string, string> = {
  '메가MGC커피': '/static/giftshoplogo/메가커피.webp',
  GS25: '/static/giftshoplogo/gs25.webp',
  CU: '/static/giftshoplogo/cu.webp',
  올리브영: '/static/giftshoplogo/올리브영.webp',
  스타벅스: '/static/giftshoplogo/스타벅스.webp',
  배달의민족: '/static/giftshoplogo/배달의민족.webp',
  투썸플레이스: '/static/giftshoplogo/투썸플레이스.webp',
  롯데리아: '/static/giftshoplogo/롯데리아.webp',
  맘스터치: '/static/giftshoplogo/맘스터치.webp',
  맥도날드: '/static/giftshoplogo/맥도날드.webp',
  파리바게뜨: '/static/giftshoplogo/파리바게트.webp',
  파리바게트: '/static/giftshoplogo/파리바게트.webp',
  세븐일레븐: '/static/giftshoplogo/세븐일레븐.webp',
  굽네치킨: '/static/giftshoplogo/굽네치킨.webp',
  굽네: '/static/giftshoplogo/굽네치킨.webp',
  파파존스: '/static/giftshoplogo/파파존스.webp',
};

// 절대 URL(관리자가 기프티쇼 CDN 원본 URL을 그대로 등록한 경우)은 그대로 쓰고,
// 상대경로(/static/...)만 BASE_URL을 붙인다. 이 체크가 없으면 절대 URL 앞에
// BASE_URL이 또 붙어(예: "https://shoppinglog.storehttp://...") 깨진 URL이 되고,
// 이미지가 흰 배경으로만 뜬다(웹은 <img src>를 그대로 써서 이 문제가 없었음).
const srv = (path?: string | null): string | null => {
  if (!path) return null;
  return /^https?:\/\//i.test(path) ? path : encodeURI(BASE_URL + path);
};

// 메가커피/메가MGC커피/메가 커피 등 변형을 하나로 (웹 normBrand)
function normBrand(raw: string): string {
  const r = String(raw || '').trim();
  const s = r.replace(/\s+/g, '').toLowerCase();
  if (s.indexOf('메가') === 0 && (s.includes('커피') || s.includes('mgc') || s.includes('coffee'))) {
    return '메가MGC커피';
  }
  return r;
}
function itemBrand(it: CatalogItem): string {
  const raw = it.brand || (it.name || '').trim().split(/\s+/)[0] || '';
  return normBrand(raw);
}
const fmt = (n: number) => Number(n || 0).toLocaleString('ko-KR');

function CoinC() {
  return (
    <View style={styles.coinC}>
      <Text style={styles.coinCText}>C</Text>
    </View>
  );
}

export default function StoreScreen() {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [balance, setBalance] = useState(0);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [activeBrand, setActiveBrand] = useState('all');
  const [sheet, setSheet] = useState<CatalogItem | null>(null);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [success, setSuccess] = useState<{ issued: boolean } | null>(null);
  const [toast, setToast] = useState('');
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      apiFetchSWR<{ items?: CatalogItem[] }>('/api/store/catalog', (d) => {
        if (alive) setItems((d.items || []).filter((it) => Number(it.cash_price || 0) > 0));
      }).catch(() => {
        if (alive) setItems([]);
      });
      apiFetch<{ user?: { points?: number } }>('/api/me/overview')
        .then((d) => {
          if (!alive) return;
          setAuthed(true);
          setBalance(Number(d.user?.points || 0));
        })
        .catch((e) => {
          if (alive && e instanceof ApiError && e.status === 401) setAuthed(false);
        });
      return () => {
        alive = false;
      };
    }, []),
  );

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2600);
  };

  // 브랜드 목록(대표 이미지 포함), 상품은 가격 오름차순
  const sorted = (items || []).slice().sort((a, b) => a.cash_price - b.cash_price);
  const brandOrder: string[] = [];
  const brandRepImg: Record<string, string | null> = {};
  sorted.forEach((it) => {
    const b = itemBrand(it);
    if (!b) return;
    if (!brandOrder.includes(b)) {
      brandOrder.push(b);
      brandRepImg[b] = srv(BRAND_LOGOS[b]) || srv(it.image_url);
    }
  });
  const shownItems = activeBrand === 'all' ? [] : sorted.filter((it) => itemBrand(it) === activeBrand);

  const openSheet = (it: CatalogItem) => {
    haptics.tap();
    disarm();
    setSheet(it);
  };
  const disarm = () => {
    setConfirmArmed(false);
    if (confirmTimer.current) {
      clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
  };
  const closeSheet = () => {
    disarm();
    setSheet(null);
  };

  const doBuy = () => {
    if (!sheet || purchasing) return;
    if (authed === false) {
      // 로그인 필요 → 웹 로그인 플로우로
      requestWebNav('/login?next=/store');
      router.dismissTo('/');
      return;
    }
    if (!confirmArmed) {
      haptics.tap();
      setConfirmArmed(true);
      confirmTimer.current = setTimeout(() => disarm(), 4000);
      return;
    }
    disarm();
    setPurchasing(true);
    apiFetch<{ purchase?: { status?: string }; refunded?: boolean }>('/api/store/purchase', {
      method: 'POST',
      body: JSON.stringify({ item_name: sheet.name, price_points: sheet.cash_price }),
    })
      .then((data) => {
        const status = data.purchase?.status;
        if (data.refunded || status === 'refunded') {
          haptics.error();
          showToast('쿠폰 발급에 실패해서 캐시를 돌려드렸어요. 잠시 후 다시 시도해주세요.');
          return;
        }
        haptics.success();
        setBalance((b) => Math.max(0, b - sheet.cash_price));
        setSheet(null);
        setSuccess({ issued: status === 'issued' });
      })
      .catch((e) => {
        haptics.error();
        const m = e instanceof ApiError && e.message ? e.message : '';
        showToast(/[가-힣]/.test(m) ? m : '네트워크 상태를 확인하고 다시 시도해주세요.');
      })
      .finally(() => setPurchasing(false));
  };

  const canAfford = authed !== false && balance >= (sheet?.cash_price || 0);
  const short = sheet ? sheet.cash_price - balance : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>캐시상점</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 히어로 배너 */}
        <Image
          source={srv('/static/banners/store-hero.webp')!}
          style={styles.banner}
          contentFit="cover"
        />

        {items === null ? (
          <Text style={styles.loading}>불러오는 중...</Text>
        ) : brandOrder.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>준비 중인 상품이 곧 올라와요</Text>
            <Text style={styles.emptySub}>모은 캐시로 교환할 상품을 채우고 있어요. 조금만 기다려 주세요.</Text>
          </View>
        ) : (
          <>
            {/* 필터 칩 */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterRow}
              contentContainerStyle={styles.filterRowInner}
            >
              {['all', ...brandOrder].map((b) => {
                const on = activeBrand === b;
                return (
                  <Pressable
                    key={b}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => {
                      haptics.tap();
                      setActiveBrand(b);
                    }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{b === 'all' ? '전체' : b}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {activeBrand === 'all' ? (
              // 브랜드 타일 그리드
              <View style={styles.brandGrid}>
                {brandOrder.map((b) => (
                  <Pressable
                    key={b}
                    style={styles.brandCard}
                    onPress={() => {
                      haptics.tap();
                      setActiveBrand(b);
                    }}
                  >
                    <View style={styles.brandThumb}>
                      {brandRepImg[b] ? (
                        <Image source={brandRepImg[b]!} style={styles.brandThumbImg} contentFit="contain" />
                      ) : (
                        <View style={styles.brandThumbTxt}>
                          <Text style={styles.brandThumbTxtLabel}>{b.charAt(0)}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.brandName} numberOfLines={1}>
                      {b}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              // 상품 그리드
              <View style={styles.grid}>
                {shownItems.map((it, i) => (
                  <Pressable key={`${it.name}-${i}`} style={styles.card} onPress={() => openSheet(it)}>
                    <View style={styles.cardThumb}>
                      {it.image_url ? (
                        <Image source={srv(it.image_url)!} style={styles.cardThumbImg} contentFit="contain" />
                      ) : (
                        <Text style={styles.cardThumbFallback}>{(it.name || '?').charAt(0)}</Text>
                      )}
                    </View>
                    <View style={styles.cardBody}>
                      <Text style={styles.cardName} numberOfLines={2}>
                        {it.name}
                      </Text>
                      <View style={styles.cardPriceRow}>
                        <CoinC />
                        <Text style={styles.cardPrice}>{fmt(it.cash_price)}</Text>
                        <Text style={styles.cardPriceUnit}>캐시</Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {/* 캐시 적립 안내 */}
            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>ⓘ 캐시 적립 안내</Text>
              <Text style={styles.infoItem}>
                <Text style={styles.infoBold}>제휴 쇼핑몰에서 한 번 이상 쇼핑 적립을 해야 캐시상점에서 교환할 수 있어요.</Text>{' '}
                (추천인·광고 적립만으로는 교환 불가)
              </Text>
              <Text style={styles.infoItem}>• 제휴 쇼핑몰 링크로 구매 시 정책에 따라 구매 확정 후 자동 적립됩니다.</Text>
              <Text style={styles.infoItem}>• 적립 현황은 캐시 내역 페이지에서 확인할 수 있습니다.</Text>
              <Text style={styles.infoItem}>• 쇼핑몰별 적립률은 실시간으로 변동될 수 있으며, 구매 시점 기준으로 적용됩니다.</Text>
            </View>
          </>
        )}
      </ScrollView>

      {!!toast && (
        <View style={styles.toastWrap} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      <WebBottomNav />

      {/* 구매 바텀시트 */}
      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={closeSheet}>
        <Pressable style={styles.sheetOverlay} onPress={closeSheet} />
        {sheet && (
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <ScrollView contentContainerStyle={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.sheetImgWrap}>
                {sheet.image_url ? (
                  <Image source={srv(sheet.image_url)!} style={styles.sheetImg} contentFit="contain" />
                ) : (
                  <Text style={styles.cardThumbFallback}>{(sheet.name || '?').charAt(0)}</Text>
                )}
              </View>
              <View style={styles.sheetContent}>
                <Text style={styles.sheetName}>{sheet.name}</Text>
                <Text style={styles.sheetPriceLine}>
                  필요 캐시 <Text style={styles.sheetPriceStrong}>{fmt(sheet.cash_price)}캐시</Text>
                </Text>
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetSectionTitle}>사용 방법</Text>
                  <Text style={styles.sheetSectionBody}>{sheet.usage_text || DEFAULT_USAGE}</Text>
                </View>
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetSectionTitle}>이용 규칙</Text>
                  <Text style={styles.sheetSectionBody}>{sheet.terms_text || DEFAULT_TERMS}</Text>
                </View>
              </View>
            </ScrollView>
            <View style={styles.sheetFooter}>
              {authed === false ? (
                <Pressable style={[styles.buyBtn, styles.buyBtnActive]} onPress={doBuy}>
                  <Text style={styles.buyBtnText}>로그인하고 구매하기</Text>
                </Pressable>
              ) : canAfford ? (
                <Pressable
                  style={[styles.buyBtn, confirmArmed ? styles.buyBtnConfirm : styles.buyBtnActive]}
                  onPress={doBuy}
                  disabled={purchasing}
                >
                  <Text style={styles.buyBtnText}>
                    {purchasing
                      ? '구매 처리 중...'
                      : confirmArmed
                        ? `한 번 더 누르면 구매 확정 · ${fmt(sheet.cash_price)}캐시`
                        : `${fmt(sheet.cash_price)}캐시로 구매하기`}
                  </Text>
                </Pressable>
              ) : (
                <>
                  <Text style={styles.shortInfo}>
                    <Text style={styles.shortInfoStrong}>{fmt(short)}캐시</Text> 부족해요
                  </Text>
                  <Pressable
                    style={[styles.buyBtn, styles.earnBtn]}
                    onPress={() => {
                      requestWebNav('/');
                      router.dismissTo('/');
                    }}
                  >
                    <Text style={styles.earnBtnText}>지금 쇼핑하러 가기 →</Text>
                  </Pressable>
                </>
              )}
            </View>
            <Pressable style={styles.sheetClose} onPress={closeSheet} hitSlop={8}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#8b95a1" strokeWidth={2} strokeLinecap="round">
                <Path d="M18 6 6 18M6 6l12 12" />
              </Svg>
            </Pressable>
          </View>
        )}
      </Modal>

      {/* 구매 성공 모달 */}
      <Modal visible={!!success} transparent animationType="fade" onRequestClose={() => setSuccess(null)}>
        <View style={styles.successOverlay}>
          <View style={styles.successCard}>
            <View style={styles.successIcon}>
              <Svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M20 6 9 17l-5-5" />
              </Svg>
            </View>
            <Text style={styles.successTitle}>구매 완료!</Text>
            <Text style={styles.successDesc}>
              {success?.issued
                ? '쿠폰이 발급되었어요. 쿠폰함에서 바로 확인하세요.'
                : '구매가 접수되었어요. 쿠폰은 잠시 후 쿠폰함에 발급돼요.'}
            </Text>
            <Pressable
              style={styles.successGo}
              onPress={() => {
                setSuccess(null);
                router.push('/coupons');
              }}
            >
              <Text style={styles.successGoText}>쿠폰함 바로가기</Text>
            </Pressable>
            <Pressable style={styles.successLater} onPress={() => setSuccess(null)}>
              <Text style={styles.successLaterText}>계속 구경하기</Text>
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
  scrollContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40 },
  banner: { width: '100%', aspectRatio: 335 / 148, borderRadius: 12, marginBottom: 20 },
  loading: { textAlign: 'center', color: '#8b95a1', paddingVertical: 40, fontSize: 14 },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#191f28', marginBottom: 8 },
  emptySub: { fontSize: 13, color: '#8b95a1', lineHeight: 21, textAlign: 'center' },
  filterRow: { marginBottom: 14 },
  filterRowInner: { gap: 6, paddingRight: 8 },
  chip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e5e8eb',
    backgroundColor: '#ffffff',
  },
  chipOn: { backgroundColor: '#3182f6', borderColor: '#3182f6' },
  chipText: { fontSize: 13, fontWeight: '700', color: '#8b95a1' },
  chipTextOn: { color: '#ffffff' },
  brandGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  brandCard: {
    width: '31.8%',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 16,
    paddingHorizontal: 8,
    marginBottom: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e8eb',
    borderRadius: 14,
  },
  brandThumb: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
  brandThumbImg: { width: 54, height: 54, borderRadius: 10 },
  brandThumbTxt: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#eff4ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandThumbTxtLabel: { fontSize: 20, fontWeight: '800', color: '#3182f6' },
  brandName: { fontSize: 13, fontWeight: '700', color: '#191f28' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: {
    width: '48.5%',
    marginBottom: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e8eb',
    borderRadius: 14,
    overflow: 'hidden',
  },
  cardThumb: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e8eb',
    padding: 12,
  },
  cardThumbImg: { width: '100%', height: '100%', borderRadius: 8 },
  cardThumbFallback: { fontSize: 30, fontWeight: '800', color: '#c4ccd6' },
  cardBody: { padding: 12, paddingTop: 10 },
  cardName: { fontSize: 14, fontWeight: '700', color: '#191f28', lineHeight: 18, marginBottom: 8, minHeight: 36 },
  cardPriceRow: { flexDirection: 'row', alignItems: 'center' },
  cardPrice: { fontSize: 15, fontWeight: '700', color: '#191f28' },
  cardPriceUnit: { fontSize: 12, fontWeight: '700', color: '#8b95a1', marginLeft: 3 },
  coinC: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#f4c22e',
    borderWidth: 2,
    borderColor: '#f9dd7b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 5,
  },
  coinCText: { fontSize: 9, fontWeight: '800', color: '#ffffff' },
  infoBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 16,
    marginTop: 20,
  },
  infoTitle: { fontSize: 14, fontWeight: '800', color: '#4e5968', marginBottom: 10 },
  infoItem: { fontSize: 12.5, color: '#8b95a1', lineHeight: 20, marginBottom: 6 },
  infoBold: { fontWeight: '700', color: '#4e5968' },
  toastWrap: {
    position: 'absolute',
    bottom: 96,
    left: 24,
    right: 24,
    backgroundColor: 'rgba(25,31,40,0.94)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  toastText: { color: '#ffffff', fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 19 },
  // 바텀시트
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%',
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#e5e8eb', alignSelf: 'center', marginTop: 12 },
  sheetClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f2f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetScroll: { paddingBottom: 8 },
  sheetImgWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    backgroundColor: '#f2f4f6',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
  },
  sheetImg: { width: '80%', height: 140, borderRadius: 12 },
  sheetContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  sheetName: { fontSize: 16, fontWeight: '700', color: '#111111', marginBottom: 4 },
  sheetPriceLine: { fontSize: 13, color: '#8b95a1', marginBottom: 20 },
  sheetPriceStrong: { color: '#191f28', fontWeight: '700' },
  sheetSection: { borderTopWidth: 1, borderTopColor: '#f2f4f6', paddingVertical: 16 },
  sheetSectionTitle: { fontSize: 13, fontWeight: '700', color: '#4e5968', marginBottom: 8 },
  sheetSectionBody: { fontSize: 13, color: '#8b95a1', lineHeight: 22 },
  sheetFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: '#f2f4f6',
    backgroundColor: '#fff',
  },
  buyBtn: { width: '100%', paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  buyBtnActive: { backgroundColor: '#3182f6' },
  buyBtnConfirm: { backgroundColor: '#fe9800' },
  buyBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  earnBtn: { backgroundColor: '#eff4ff' },
  earnBtnText: { color: '#2272eb', fontSize: 15, fontWeight: '800' },
  shortInfo: { textAlign: 'center', fontSize: 13, color: '#8b95a1', fontWeight: '600', marginBottom: 10 },
  shortInfoStrong: { color: '#f04452', fontWeight: '800' },
  // 성공 모달
  successOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  successCard: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 20, padding: 28, alignItems: 'center' },
  successIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successTitle: { fontSize: 20, fontWeight: '800', color: '#191f28', marginBottom: 8 },
  successDesc: { fontSize: 14, color: '#8b95a1', textAlign: 'center', lineHeight: 21, marginBottom: 22 },
  successGo: { width: '100%', backgroundColor: '#3182f6', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  successGoText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  successLater: { paddingVertical: 12, marginTop: 4 },
  successLaterText: { color: '#8b95a1', fontSize: 14, fontWeight: '600' },
});
