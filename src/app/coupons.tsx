import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Barcode from 'react-native-barcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import WebBottomNav from '@/components/WebBottomNav';
import { ApiError, apiFetchSWR, BASE_URL } from '@/lib/api';
import * as haptics from '@/lib/haptics';

// 웹 /coupons(static/coupons-inline-1.js)의 네이티브 구현.
// 기프티콘 카드 목록(상태 필터) → 쿠폰 모달(바코드 CODE128 + 핀 복사).
// 바코드는 웹과 동일하게 coupon_barcode_url 우선, 없으면 핀으로 로컬 생성.

type Purchase = {
  id: number;
  item_name: string;
  item_brand?: string;
  item_image?: string;
  price_points?: number;
  status?: string;
  source?: string;
  coupon_pin?: string;
  coupon_barcode_url?: string;
  coupon_expire_at?: number;
};

// 웹 coupons-inline-1.js ITEM_IMGS 폴백 맵 그대로
const ITEM_IMGS: Record<string, string> = {
  '네이버페이 포인트 5,000원': '/static/giftshoplogo/npay5000.webp',
  '네이버페이 포인트 10,000원': '/static/giftshoplogo/npay10000.webp',
  '네이버페이 포인트 30,000원': '/static/giftshoplogo/npay30000.webp',
  '스타벅스 아이스 아메리카노': '/static/logos/items/starbucksice.webp',
  '메가커피 아메리카노': '/static/giftshoplogo/megacoffee.webp',
  '올리브영 10,000원권': '/static/giftshoplogo/OLIVEYOUNG.webp',
  'GS25 상품권 5,000원': '/static/giftshoplogo/GS255000.webp',
  'CU 상품권 5,000원': '/static/giftshoplogo/CU5000.webp',
  '배달의민족 상품권 10,000원': '/static/giftshoplogo/%EB%B0%B0%EB%8B%AC%EC%9D%98%EB%AF%BC%EC%A1%B110000.webp',
};

const STATUS_LABEL: Record<string, string> = {
  issued: '사용 가능',
  pending: '처리 중',
  used: '사용 완료',
  expired: '만료',
};
const STATUS_COLOR: Record<string, [bg: string, fg: string]> = {
  issued: ['#e8f7ef', '#059669'],
  pending: ['#fff7e6', '#b45309'],
  used: ['#f1f5f9', '#94a3b8'],
  expired: ['#fef1f2', '#dc2626'],
};

const FILTERS: [key: string, label: string][] = [
  ['all', '전체'],
  ['issued', '사용 가능'],
  ['pending', '처리 중'],
  ['used', '사용 완료'],
];

const fmtDate = (ts?: number) => {
  if (!ts) return '';
  const d = new Date(Number(ts) * 1000);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

function couponStatus(p: Purchase): string {
  const status = p.status || 'pending';
  if (status === 'issued' && p.coupon_expire_at && p.coupon_expire_at * 1000 < Date.now()) return 'expired';
  return status;
}

function imgSrc(p: Purchase): string | null {
  const raw = p.item_image || ITEM_IMGS[p.item_name] || '';
  if (!raw) return null;
  return /^https?:/i.test(raw) ? raw : BASE_URL + raw;
}

export default function CouponsScreen() {
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<Purchase | null>(null);
  const [pinCopied, setPinCopied] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      apiFetchSWR<{ purchases?: Purchase[]; items?: Purchase[] }>('/api/store/purchases/me', (d) => {
        if (alive) setPurchases(d.purchases || d.items || []);
      }).catch((e) => {
        if (alive && e instanceof ApiError && e.status === 401) router.back();
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  const shown = (purchases || []).filter((p) => filter === 'all' || couponStatus(p) === filter);

  const copyPin = async (pin: string) => {
    haptics.tap();
    try {
      await Clipboard.setStringAsync(pin);
      setPinCopied(true);
      setTimeout(() => setPinCopied(false), 1500);
    } catch {}
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>쿠폰함</Text>
        <View style={styles.backBtn} />
      </View>

      {/* 상태 필터 탭 */}
      <View style={styles.tabs}>
        {FILTERS.map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.tab, filter === key && styles.tabActive]}
            onPress={() => {
              haptics.tap();
              setFilter(key);
            }}
          >
            <Text style={[styles.tabText, filter === key && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={shown}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {purchases === null ? '불러오는 중...' : '해당하는 쿠폰이 없어요'}
          </Text>
        }
        renderItem={({ item: p }) => {
          const status = couponStatus(p);
          const [bg, fg] = STATUS_COLOR[status] || STATUS_COLOR.pending;
          const src = imgSrc(p);
          const dim = status === 'used' || status === 'expired';
          return (
            <Pressable
              style={({ pressed }) => [styles.card, dim && { opacity: 0.55 }, pressed && status === 'issued' && styles.cardPressed]}
              onPress={() => {
                if (status !== 'issued') return;
                haptics.tap();
                setSelected(p);
              }}
            >
              <View style={styles.cardImgWrap}>
                {src ? (
                  <Image source={{ uri: src }} style={styles.cardImg} contentFit="contain" />
                ) : (
                  <Text style={styles.cardEmoji}>🎁</Text>
                )}
              </View>
              <View style={styles.cardInfo}>
                <View style={styles.cardTopline}>
                  {!!p.item_brand && <Text style={styles.cardBrand}>{p.item_brand}</Text>}
                  <View style={[styles.badge, { backgroundColor: bg }]}>
                    <Text style={[styles.badgeText, { color: fg }]}>{STATUS_LABEL[status] || status}</Text>
                  </View>
                </View>
                <Text style={styles.cardName} numberOfLines={1}>
                  {p.item_name}
                </Text>
                <Text style={styles.cardMeta}>
                  {p.source === 'tournament'
                    ? '🏆 가위바위보 경품'
                    : `${Number(p.price_points || 0).toLocaleString('ko-KR')}캐시${p.coupon_expire_at ? ` · 유효기간 ${fmtDate(p.coupon_expire_at)}` : ''}`}
                </Text>
                {status === 'pending' && (
                  <Text style={styles.pendingHint}>발급 처리 중 · 잠시 후 확인해주세요</Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />
      <WebBottomNav />

      {/* 쿠폰 모달: 바코드 + 핀 */}
      <Modal visible={selected !== null} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <ScrollView contentContainerStyle={styles.modalContent}>
              {selected !== null && (
                <>
                  <View style={styles.modalProduct}>
                    {imgSrc(selected) ? (
                      <Image source={{ uri: imgSrc(selected)! }} style={styles.modalThumb} contentFit="contain" />
                    ) : (
                      <Text style={styles.cardEmoji}>🎁</Text>
                    )}
                    <View style={styles.modalProductInfo}>
                      {!!selected.item_brand && <Text style={styles.modalBrand}>{selected.item_brand}</Text>}
                      <Text style={styles.modalName}>{selected.item_name}</Text>
                    </View>
                  </View>

                  <View style={styles.barcodeBox}>
                    {selected.coupon_barcode_url ? (
                      <Image
                        source={{ uri: selected.coupon_barcode_url }}
                        style={styles.barcodeImg}
                        contentFit="contain"
                      />
                    ) : selected.coupon_pin ? (
                      <Barcode value={selected.coupon_pin} format="CODE128" height={80} singleBarWidth={2} />
                    ) : (
                      <Text style={styles.barcodeEmpty}>바코드 이미지가 준비 중입니다.</Text>
                    )}
                  </View>

                  <View style={styles.pinRow}>
                    <Text style={styles.pinCode} selectable>
                      {selected.coupon_pin || '—'}
                    </Text>
                    {!!selected.coupon_pin && (
                      <Pressable style={styles.pinCopy} onPress={() => copyPin(selected.coupon_pin!)}>
                        <Text style={styles.pinCopyText}>{pinCopied ? '완료' : '복사'}</Text>
                      </Pressable>
                    )}
                  </View>

                  {!!selected.coupon_expire_at && (
                    <Text style={styles.expire}>
                      유효기간 <Text style={styles.expireBold}>{fmtDate(selected.coupon_expire_at)}까지</Text>
                    </Text>
                  )}
                  <Text style={styles.guide}>결제 전 바코드 또는 쿠폰 번호를 직원에게 보여주세요.</Text>

                  <Pressable style={styles.modalClose} onPress={() => setSelected(null)}>
                    <Text style={styles.modalCloseText}>닫기</Text>
                  </Pressable>
                </>
              )}
            </ScrollView>
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
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tab: { flex: 1, paddingVertical: 11, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#0f172a' },
  tabText: { fontSize: 13.5, fontWeight: '700', color: '#8b95a1' },
  tabTextActive: { color: '#0f172a' },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 10 },
  empty: { textAlign: 'center', color: '#8b95a1', fontSize: 13.5, paddingVertical: 48 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eef0f4',
    borderRadius: 16,
    padding: 13,
  },
  cardPressed: { backgroundColor: '#f8fafc' },
  cardImgWrap: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardImg: { width: 48, height: 48 },
  cardEmoji: { fontSize: 28 },
  cardInfo: { flex: 1, minWidth: 0 },
  cardTopline: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  cardBrand: { fontSize: 11.5, fontWeight: '700', color: '#8b95a1' },
  badge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 10.5, fontWeight: '800' },
  cardName: { fontSize: 14.5, fontWeight: '800', color: '#191f28' },
  cardMeta: { fontSize: 12, color: '#8b95a1', marginTop: 2 },
  pendingHint: { fontSize: 11.5, fontWeight: '700', color: '#b45309', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '85%',
  },
  modalContent: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 34 },
  modalProduct: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  modalThumb: { width: 56, height: 56, borderRadius: 12 },
  modalProductInfo: { flex: 1 },
  modalBrand: { fontSize: 12, fontWeight: '700', color: '#8b95a1' },
  modalName: { fontSize: 16, fontWeight: '800', color: '#191f28', marginTop: 2 },
  barcodeBox: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eef0f4',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 10,
    minHeight: 110,
  },
  barcodeImg: { width: '100%', height: 90 },
  barcodeEmpty: { fontSize: 13, color: '#8b95a1' },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pinCode: { flex: 1, fontSize: 16, fontWeight: '800', color: '#191f28', letterSpacing: 1 },
  pinCopy: { backgroundColor: '#111827', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  pinCopyText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  expire: { fontSize: 13, color: '#4e5968', marginTop: 12, textAlign: 'center' },
  expireBold: { fontWeight: '800', color: '#191f28' },
  guide: { fontSize: 12.5, color: '#8b95a1', marginTop: 6, textAlign: 'center' },
  modalClose: {
    marginTop: 18,
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalCloseText: { fontSize: 15, fontWeight: '800', color: '#334155' },
});
