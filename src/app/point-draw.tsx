import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import WebBottomNav from '@/components/WebBottomNav';
import { apiFetch, ApiError, apiFetchSWR, BASE_URL, isNativeScreenEnabled } from '@/lib/api';
import * as haptics from '@/lib/haptics';
import { markWebStateDirty, requestWebNav } from '@/lib/webNav';

// 웹 /point-draw(static/point-draw-inline-1.js)의 네이티브 구현.
// 밴드 목록 → 밴드 상세(상품 그리드 + 릴 하이라이트) → 결과 모달.
// 릴은 웹과 동일하게 "클릭 즉시 회전 → 응답 오면 당첨 칸에 감속 정지".

type DrawItem = { name: string; image_url?: string; is_blank?: boolean };
type Band = {
  id: number;
  name: string;
  subtitle?: string;
  mascot_img?: string;
  logo_img?: string;
  cost_points: number;
  drawn_today?: boolean;
  items?: DrawItem[];
};
type BandsResp = { logged_in?: boolean; balance?: number; bands?: Band[] };
type DrawResp = {
  status?: string;
  won?: { name?: string; image_url?: string };
  balance?: number;
};

const fmt = (n: number) => Number(n || 0).toLocaleString('ko-KR');
const srvImg = (p?: string) =>
  p ? { uri: /^https?:/i.test(p) ? p : encodeURI(BASE_URL + p) } : null;

function openWeb(path: string) {
  haptics.tap();
  requestWebNav(path);
  router.dismissTo('/');
}

export default function PointDrawScreen() {
  const [balance, setBalance] = useState(0);
  const [bands, setBands] = useState<Band[] | null>(null);
  const [current, setCurrent] = useState<Band | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [highlight, setHighlight] = useState(-1); // 릴 하이라이트 인덱스
  const [winIdx, setWinIdx] = useState(-1);
  const [result, setResult] = useState<{ won: DrawResp['won']; sub: string; blank: boolean } | null>(null);

  const loadBands = useCallback(() => {
    apiFetchSWR<BandsResp>('/api/draw/bands', (d) => {
      setBalance(Number(d.balance || 0));
      setBands(d.bands || []);
    }, 5 * 60_000).catch((e) => {
      if (e instanceof ApiError && e.status === 401) router.back();
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadBands();
    }, [loadBands]),
  );

  // ── 릴 상태 머신 (웹 startReel 타이밍 그대로) ──────────────────────────────
  const reel = useRef<{
    step: number;
    target: number | null;
    decelTotal: number;
    aborted: boolean;
    n: number;
    onDone: (() => void) | null;
  } | null>(null);
  const reelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopReelTimer = () => {
    if (reelTimer.current) {
      clearTimeout(reelTimer.current);
      reelTimer.current = null;
    }
  };
  useEffect(() => stopReelTimer, []);

  // 릴 진행은 전부 ref 기반이라 렌더마다 재생성돼도 안전하다 (훅 불필요)
  function reelTick() {
    const r = reel.current;
    if (!r || r.aborted) {
      setHighlight(-1);
      return;
    }
    const idx = r.step % r.n;
    setHighlight(idx);
    if (r.target !== null && r.step >= r.target) {
      setHighlight(-1);
      setWinIdx(idx);
      const done = r.onDone;
      reel.current = null;
      setTimeout(() => done && done(), 620);
      return;
    }
    r.step++;
    let delay: number;
    if (r.target === null) {
      delay = r.step < 6 ? Math.round(210 - r.step * 28) : 45;
    } else {
      const p = 1 - (r.target - r.step) / r.decelTotal;
      delay = Math.round(45 + Math.pow(p, 1.6) * 290);
    }
    reelTimer.current = setTimeout(reelTick, delay);
  }

  function startReel(n: number) {
    setWinIdx(-1);
    reel.current = { step: 0, target: null, decelTotal: 1, aborted: false, n, onDone: null };
    reelTick();
  }

  function landReel(targetIdx: number, onDone: () => void) {
    const r = reel.current;
    if (!r) {
      onDone();
      return;
    }
    const win = targetIdx >= 0 && targetIdx < r.n ? targetIdx : 0;
    const ahead = (win - (r.step % r.n) + r.n) % r.n;
    const extra = r.n + ahead;
    r.target = r.step + extra;
    r.decelTotal = extra;
    r.onDone = onDone;
  }

  function abortReel() {
    if (reel.current) reel.current.aborted = true;
    stopReelTimer();
    setHighlight(-1);
  }

  // ── 뽑기 ────────────────────────────────────────────────────────────────
  function doDraw() {
    const b = current;
    if (!b || drawing) return;
    if (b.drawn_today || balance < b.cost_points) return;
    setDrawing(true);
    haptics.tap();
    const items = b.items || [];
    startReel(items.length || 1);
    apiFetch<DrawResp>(`/api/draw/${b.id}`, { method: 'POST' })
      .then((body) => {
        markWebStateDirty();
        const winName = body.won?.name || '';
        let idx = items.findIndex((it) => it.name === winName);
        if (idx < 0) idx = 0;
        landReel(idx, () => {
          setDrawing(false);
          setBalance(Number(body.balance != null ? body.balance : balance));
          setBands((bs) =>
            (bs || []).map((x) => (x.id === b.id ? { ...x, drawn_today: true } : x)),
          );
          setCurrent((c) => (c && c.id === b.id ? { ...c, drawn_today: true } : c));
          const blank = body.status === 'blank';
          setResult({
            won: body.won,
            sub: blank
              ? '아쉽지만 꽝이에요 😢 다음 기회에!'
              : body.status === 'issued'
                ? '기프티콘이 쿠폰함에 발급됐어요'
                : '곧 쿠폰함으로 발급돼요. 잠시만 기다려 주세요!',
            blank,
          });
          if (blank) haptics.error();
          else haptics.success();
        });
      })
      .catch((e) => {
        abortReel();
        setDrawing(false);
        if (e instanceof ApiError && e.status === 429) {
          setBands((bs) => (bs || []).map((x) => (x.id === b.id ? { ...x, drawn_today: true } : x)));
          setCurrent((c) => (c && c.id === b.id ? { ...c, drawn_today: true } : c));
        }
        haptics.error();
      });
  }

  const ctaState = (() => {
    const b = current;
    if (!b) return { text: '불러오는 중…', disabled: true };
    if (drawing) return { text: '뽑는 중…', disabled: true };
    if (b.drawn_today) return { text: '오늘 뽑기 완료 · 내일 다시 도전!', disabled: true };
    if (balance < b.cost_points) return { text: '포인트가 부족해요', disabled: true };
    return { text: `${fmt(b.cost_points)}포인트로 뽑기`, disabled: false };
  })();

  // ── 렌더 ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {current === null ? (
        // 밴드 목록 (랜딩)
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.balanceCard}>
            <View style={styles.balanceInfo}>
              <Text style={styles.balanceLabel}>보유 포인트</Text>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceAmount}>{fmt(balance)}</Text>
                <View style={styles.balanceCoin}>
                  <Text style={styles.balanceCoinText}>P</Text>
                </View>
              </View>
              <Pressable style={styles.balanceLink} onPress={() => openWeb('/go/coupang')}>
                <Text style={styles.balanceLinkText}>쿠팡에서 적립 ›</Text>
              </Pressable>
            </View>
            <Image
              source={srvImg('/static/gift-t.webp')!}
              style={styles.balanceIllust}
              contentFit="contain"
            />
          </View>

          <Text style={styles.listTitle}>포인트 뽑기</Text>
          {bands === null ? (
            <Text style={styles.emptyText}>불러오는 중...</Text>
          ) : bands.length === 0 ? (
            <Text style={styles.emptyText}>준비 중인 뽑기예요. 곧 열릴 거예요!</Text>
          ) : (
            <View style={styles.bandGrid}>
              {bands.map((b) => {
                const done = !!b.drawn_today;
                const logo = b.logo_img || b.items?.[0]?.image_url || '';
                return (
                  <Pressable
                    key={b.id}
                    style={[styles.bandCard, done && { opacity: 0.55 }]}
                    onPress={() => {
                      haptics.tap();
                      setCurrent(b);
                      setWinIdx(-1);
                    }}
                  >
                    {logo ? (
                      <Image source={srvImg(logo)!} style={styles.bandThumb} contentFit="contain" />
                    ) : (
                      <View style={[styles.bandThumb, styles.bandThumbTxt]}>
                        <Text style={styles.bandThumbTxtLabel}>{(b.name || '?').slice(0, 3)}</Text>
                      </View>
                    )}
                    <Text style={styles.bandName} numberOfLines={1}>
                      {b.name}
                    </Text>
                    <Text style={[styles.bandPillText, done && styles.bandPillTextDone]}>
                      {done ? '오늘 완료' : `${fmt(b.cost_points)}P`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      ) : (
        // 밴드 상세 (뽑기)
        <>
          <View style={styles.detailTop}>
            <Pressable
              style={styles.backBtn}
              onPress={() => {
                if (drawing) return;
                haptics.tap();
                setCurrent(null);
                setWinIdx(-1);
              }}
              hitSlop={10}
            >
              <Text style={styles.backChevron}>‹</Text>
            </Pressable>
            <Text style={styles.detailTitle}>{current.name}</Text>
            <View style={styles.backBtn} />
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.detailContent}>
            <Text style={styles.heroTitle}>
              {current.subtitle || '포인트로 기프티콘 추첨해보세요!'}
            </Text>
            <View style={styles.heroRow}>
              <View style={styles.bubble}>
                <Text style={styles.bubbleText}>
                  아래 상품 중 하나가 <Text style={styles.bubbleBold}>랜덤</Text>으로 지급돼요
                </Text>
              </View>
            </View>

            <View style={styles.itemGrid}>
              {(current.items || []).map((it, i) => {
                const active = highlight === i;
                const isWin = winIdx === i;
                return (
                  <View
                    key={`${i}-${it.name}`}
                    style={[
                      styles.itemCard,
                      it.is_blank && styles.itemCardBlank,
                      (active || isWin) && styles.itemCardActive,
                      isWin && styles.itemCardWin,
                    ]}
                  >
                    <View style={styles.itemThumb}>
                      {it.is_blank ? (
                        <Text style={styles.itemBlank}>꽝</Text>
                      ) : it.image_url ? (
                        <Image source={srvImg(it.image_url)!} style={styles.itemImg} contentFit="contain" />
                      ) : (
                        <Text style={styles.itemNoImg}>🎁</Text>
                      )}
                    </View>
                    <Text style={styles.itemBrand}>{it.is_blank ? '꽝' : current.name}</Text>
                    <Text style={styles.itemName} numberOfLines={2}>
                      {it.is_blank ? '아쉽지만 꽝!' : it.name}
                    </Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
          <View style={styles.ctaBar}>
            <Pressable
              style={[styles.cta, ctaState.disabled && styles.ctaMuted]}
              onPress={doDraw}
              disabled={ctaState.disabled}
            >
              <Text style={[styles.ctaText, ctaState.disabled && styles.ctaTextMuted]}>
                {ctaState.text}
              </Text>
            </Pressable>
          </View>
        </>
      )}
      {current === null && <WebBottomNav active="point-draw" />}

      {/* 결과 모달 */}
      <Modal visible={result !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalBadge}>{result?.blank ? '😢 꽝!' : '🎉 축하해요!'}</Text>
            {!!result?.won?.image_url && (
              <Image
                source={srvImg(result.won.image_url)!}
                style={styles.modalImg}
                contentFit="contain"
              />
            )}
            <Text style={styles.modalName}>
              {result?.won?.name || (result?.blank ? '꽝' : '당첨!')}
            </Text>
            <Text style={styles.modalSub}>{result?.sub}</Text>
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => {
                  setResult(null);
                  loadBands();
                }}
              >
                <Text style={styles.modalBtnGhostText}>닫기</Text>
              </Pressable>
              {!result?.blank && (
                <Pressable
                  style={[styles.modalBtn, styles.modalBtnPrimary]}
                  onPress={() => {
                    setResult(null);
                    if (isNativeScreenEnabled('coupons')) {
                      haptics.tap();
                      router.push('/coupons');
                    } else openWeb('/coupons');
                  }}
                >
                  <Text style={styles.modalBtnPrimaryText}>쿠폰함 보기</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// styles.css .pd-* 값 그대로
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  balanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#3182f6',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 20,
    minHeight: 148, // 웹과 동일 — 홈 배너 335:148과 높이감 통일
    marginTop: 8,
    marginBottom: 20,
  },
  balanceInfo: { flex: 1 },
  balanceLabel: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  balanceAmount: { fontSize: 34, fontWeight: '800', color: '#ffffff', letterSpacing: -0.6 },
  // 웹 .pd-balance-unit 과 동일 — 파란 원형 P 코인 배지(진한 원 + 밝은 링)
  balanceCoin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#2f6be6',
    borderWidth: 2.5,
    borderColor: '#83aaf3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceCoinText: { fontSize: 14, fontWeight: '800', color: '#ffffff' },
  balanceLink: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  balanceLinkText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  balanceIllust: { width: 104, height: 104 },
  listTitle: { fontSize: 19, fontWeight: '900', color: '#0f172a', letterSpacing: -0.5, marginBottom: 12, marginHorizontal: 2 },
  emptyText: { textAlign: 'center', color: '#94a3b8', fontSize: 14, paddingVertical: 40 },
  // 3열: gap 대신 space-between 사용 — width%+gap 합이 폭을 넘어 2열로 줄바꿈되던 버그 수정
  bandGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  bandCard: {
    width: '31.5%',
    marginBottom: 10,
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e8eb',
    borderRadius: 14,
    paddingTop: 16,
    paddingBottom: 12,
    paddingHorizontal: 8,
  },
  bandThumb: { width: 44, height: 44, borderRadius: 12 },
  bandThumbTxt: { backgroundColor: '#eff4ff', alignItems: 'center', justifyContent: 'center' },
  bandThumbTxtLabel: { fontSize: 13, fontWeight: '800', color: '#3182f6' },
  bandName: { fontSize: 13, fontWeight: '700', color: '#191f28' },
  // 알약 제거 — 그냥 파란 텍스트로 몇 포인트인지만 표기
  bandPillText: { fontSize: 13, fontWeight: '800', color: '#3182f6' },
  bandPillTextDone: { color: '#94a3b8', fontWeight: '700' },
  detailTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    height: 48,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backChevron: { fontSize: 30, color: '#1e293b', marginTop: -4 },
  detailTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  detailContent: { paddingHorizontal: 16, paddingBottom: 100 },
  heroTitle: { fontSize: 20, fontWeight: '900', color: '#0f172a', letterSpacing: -0.4, marginTop: 6, marginBottom: 12 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 10 },
  bubble: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  bubbleText: { fontSize: 13, fontWeight: '600', color: '#334155', lineHeight: 19 },
  bubbleBold: { color: '#2272eb', fontWeight: '800' },
  itemGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  itemCard: {
    width: '48.7%',
    backgroundColor: '#f6f7f9',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 11,
    alignItems: 'center',
    gap: 3,
  },
  itemCardBlank: { backgroundColor: '#f1f3f6' },
  itemCardActive: {
    borderWidth: 3,
    borderColor: '#3182f6',
    transform: [{ scale: 1.04 }],
    zIndex: 2,
  },
  itemCardWin: { transform: [{ scale: 1.06 }] },
  itemThumb: { width: '100%', height: 74, alignItems: 'center', justifyContent: 'center' },
  itemImg: { width: 64, height: 64, borderRadius: 12 },
  itemBlank: { fontSize: 26, fontWeight: '900', color: '#94a3b8' },
  itemNoImg: { fontSize: 30 },
  itemBrand: { fontSize: 11, fontWeight: '700', color: '#8b95a1' },
  itemName: { fontSize: 12.5, fontWeight: '700', color: '#191f28', textAlign: 'center', lineHeight: 17 },
  ctaBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f1f3f6',
  },
  cta: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: '#3182f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaMuted: { backgroundColor: '#e2e8f0' },
  ctaText: { color: '#ffffff', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  ctaTextMuted: { color: '#94a3b8' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  modalCard: {
    alignSelf: 'stretch',
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingVertical: 26,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  modalBadge: { fontSize: 18, fontWeight: '900', color: '#0f172a' },
  modalImg: { width: 120, height: 120, marginTop: 12 },
  modalName: { fontSize: 18, fontWeight: '800', color: '#191f28', marginTop: 10, textAlign: 'center' },
  modalSub: { fontSize: 13.5, color: '#64748b', marginTop: 6, textAlign: 'center' },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 20, alignSelf: 'stretch' },
  modalBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  modalBtnGhost: { backgroundColor: '#f1f5f9' },
  modalBtnGhostText: { color: '#334155', fontSize: 15, fontWeight: '800' },
  modalBtnPrimary: { backgroundColor: '#3182f6' },
  modalBtnPrimaryText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
});
