import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Path, Polygon, Rect } from 'react-native-svg';

import WebBottomNav from '@/components/WebBottomNav';
import { showRewardedAd } from '@/lib/admob';
import { apiFetch, ApiError, apiFetchSWR, BASE_URL } from '@/lib/api';
import { openOfferwall } from '@/lib/adpopcorn';
import * as haptics from '@/lib/haptics';
import { markWebStateDirty } from '@/lib/webNav';

// 웹 /charge(templates/charge.html + static/charge.js)의 네이티브 구현.
// - 광고 적립: 서버 검증 완료 전까지 웹과 동일하게 '준비중'
// - 미션적립(오퍼월): 이 빌드엔 네이티브 모듈이 있으므로 바로 활성.
//   적립은 애드팝콘 → 서버 포스트백이 처리, 여기선 열고 복귀 시 잔액 갱신만.
// - SNS 채널 추가(채널 열기 + 즉시 적립, 서버가 중복 차단), 버그/리뷰 미션 안내 모달.

const SNS_KAKAO_URL = 'https://pf.kakao.com/_ybbGX';
const SNS_INSTAGRAM_URL = 'https://www.instagram.com/shopping_log_official';

type Overview = { user?: { id?: number; points?: number } };
type SnsStatus = { claimed?: Record<string, { claimed?: boolean; claimed_at?: number } | number | boolean> };

// 웹 charge.js MISSIONS 문구 그대로
const MISSIONS = {
  bug: {
    title: '버그/개선 제보',
    reward: '채택 시 최대 2,000캐시',
    desc: '서비스 오류·개선 아이디어를 카카오톡 채널로 보내주세요. 채택되면 기여도에 따라 최대 2,000캐시를 드려요.',
    cta: '카톡 채널로 버그 제보하기',
  },
  review: {
    title: '리뷰 쓰기',
    reward: '최초 1회 · 200캐시',
    desc: '솔직한 리뷰(캡처)를 카카오톡 채널로 보내주세요. 최초 1회에 한해 200캐시를 드려요.',
    cta: '카톡 채널로 리뷰 남기기',
  },
} as const;

// 오퍼월(별도 네이티브 액티비티)을 연 시각 — 복귀 감지용.
// useRef 로 두면 react-compiler 가 렌더 중 ref 접근으로 오검출하므로 모듈 스코프에 둔다.
let offerwallOpenAtMs = 0;

function CardIcon({ kind }: { kind: 'ad' | 'mission' | 'kakao' | 'insta' | 'bug' | 'review' }) {
  const stroke = {
    ad: '#f04452',
    mission: '#0ea5e9',
    kakao: '#3A1D1D',
    insta: '#db2777',
    bug: '#7c3aed',
    review: '#f59e0b',
  }[kind];
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
    case 'ad':
      return (
        <Svg {...common}>
          <Rect x={2} y={5} width={20} height={14} rx={3} />
          <Path d="m10 9 5 3-5 3z" />
        </Svg>
      );
    case 'mission':
      return (
        <Svg {...common}>
          <Path d="M9 11l3 3L22 4" />
          <Path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </Svg>
      );
    case 'kakao':
      return (
        <Svg width={26} height={26} viewBox="0 0 24 24" fill="#3A1D1D">
          <Path d="M12 3C6.48 3 2 6.48 2 10.77c0 2.75 1.85 5.17 4.63 6.55l-.94 3.47c-.08.31.27.56.54.38l4.14-2.74c.53.07 1.08.11 1.63.11 5.52 0 10-3.48 10-7.77S17.52 3 12 3z" />
        </Svg>
      );
    case 'insta':
      return (
        <Svg {...common}>
          <Rect x={2} y={2} width={20} height={20} rx={5} />
          <Path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <Line x1={17.5} y1={6.5} x2={17.51} y2={6.5} />
        </Svg>
      );
    case 'bug':
      return (
        <Svg {...common}>
          <Path d="m8 2 1.88 1.88" />
          <Path d="M14.12 3.88 16 2" />
          <Path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
          <Path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z" />
          <Path d="M12 20v-9" />
          <Path d="M6 13H2" />
          <Path d="M22 13h-4" />
        </Svg>
      );
    case 'review':
      return (
        <Svg {...common}>
          <Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </Svg>
      );
  }
}

export default function ChargeScreen() {
  const [userId, setUserId] = useState<number | null>(null);
  const [snsClaimed, setSnsClaimed] = useState<Record<string, boolean>>({});
  const [snsBusy, setSnsBusy] = useState<string | null>(null);
  const [snsToast, setSnsToast] = useState('');
  const [mission, setMission] = useState<'bug' | 'review' | null>(null);
  // 리워드 광고 설정 — 서버 /api/app-config(ads.rewarded). 광고 단위 ID + SSV 둘 다
  // 설정돼야 enabled. 미설정이면 '준비중' 유지(웹 setupAdCard와 동일 기준).
  const [rewarded, setRewarded] = useState<{ enabled: boolean; adUnit: string }>({ enabled: false, adUnit: '' });
  const [adBusy, setAdBusy] = useState(false);

  const loadSns = useCallback(() => {
    apiFetch<SnsStatus>('/api/charge/sns-status')
      .then((d) => {
        const claimed: Record<string, boolean> = {};
        Object.entries(d.claimed || {}).forEach(([ch, v]) => {
          claimed[ch] = typeof v === 'object' && v !== null ? (v as { claimed?: boolean }).claimed !== false : !!v;
        });
        setSnsClaimed(claimed);
      })
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      apiFetchSWR<Overview>('/api/me/overview', (d) => {
        if (alive && d.user?.id != null) setUserId(Number(d.user.id));
      }).catch((e) => {
        if (alive && e instanceof ApiError && e.status === 401) router.back();
      });
      loadSns();
      fetch(`${BASE_URL}/api/app-config`)
        .then((r) => (r.ok ? r.json() : null))
        .then((cfg) => {
          if (!alive || !cfg) return;
          const rw = (cfg.ads && cfg.ads.rewarded) || {};
          setRewarded({ enabled: !!rw.enabled, adUnit: String(rw.ad_unit_id || '') });
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [loadSns]),
  );

  // 광고 적립: 리워드 광고 시청 → 적립은 Google SSV 콜백이 서버에서 처리, 여기선 안내만.
  const watchAd = useCallback(() => {
    if (adBusy || !rewarded.adUnit || userId == null) return;
    haptics.tap();
    setAdBusy(true);
    showRewardedAd(rewarded.adUnit, String(userId))
      .then((ok) => {
        if (!ok) {
          setSnsToast('광고를 끝까지 시청해야 적립돼요.');
          return;
        }
        setSnsToast('적립 처리 중이에요. 잠시만요!');
        markWebStateDirty(); // 웹뷰 잔액 캐시 무효화(SSV 적립 반영)
      })
      .catch(() => setSnsToast('광고를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'))
      .finally(() => {
        setAdBusy(false);
        setTimeout(() => setSnsToast(''), 2500);
      });
  }, [adBusy, rewarded.adUnit, userId]);

  // 오퍼월(별도 네이티브 액티비티)에서 복귀하면 잔액이 바뀌었을 수 있다 → 웹뷰 캐시 무효화
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && offerwallOpenAtMs && Date.now() - offerwallOpenAtMs > 3000) {
        offerwallOpenAtMs = 0;
        markWebStateDirty();
      }
    });
    return () => sub.remove();
  }, []);

  const openOfferwallCard = useCallback(() => {
    if (userId == null) return;
    haptics.tap();
    offerwallOpenAtMs = Date.now();
    openOfferwall(String(userId));
  }, [userId]);

  const claimSns = (channel: 'kakao' | 'instagram', url: string) => {
    if (snsBusy || snsClaimed[channel]) return;
    haptics.tap();
    Linking.openURL(url).catch(() => {});
    setSnsBusy(channel);
    apiFetch<{ ok?: boolean; reward?: number; points?: number }>('/api/charge/sns-reward', {
      method: 'POST',
      body: JSON.stringify({ channel }),
    })
      .then((d) => {
        markWebStateDirty();
        setSnsClaimed((c) => ({ ...c, [channel]: true }));
        setSnsToast(`+${Number(d.reward || 50).toLocaleString('ko-KR')}캐시 적립!`);
        haptics.success();
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 409) {
          setSnsClaimed((c) => ({ ...c, [channel]: true }));
          setSnsToast('이미 적립받은 미션이에요.');
        } else {
          setSnsToast('잠시 후 다시 시도해주세요.');
          haptics.error();
        }
      })
      .finally(() => {
        setSnsBusy(null);
        setTimeout(() => setSnsToast(''), 2500);
      });
  };

  const card = (
    icon: React.ReactNode,
    iconBg: string,
    title: string,
    desc: string,
    btn: React.ReactNode,
    onPress?: () => void,
    soon = false,
  ) => (
    <Pressable
      style={({ pressed }) => [styles.card, soon && styles.cardSoon, pressed && onPress && styles.cardPressed]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={[styles.cardIcon, { backgroundColor: iconBg }]}>{icon}</View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>
          {title}
          {soon && <Text style={styles.soonBadge}>  준비중</Text>}
        </Text>
        <Text style={styles.cardDesc}>{desc}</Text>
      </View>
      {btn}
    </Pressable>
  );

  const rewardBtn = (label: string, onPress?: () => void, disabled = false, ghost = false) => (
    <Pressable
      style={[styles.cardBtn, (ghost || disabled) && styles.cardBtnGhost]}
      onPress={onPress}
      disabled={disabled || !onPress}
      hitSlop={6}
    >
      <Text style={[styles.cardBtnText, (ghost || disabled) && styles.cardBtnTextGhost]}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>캐시 충전소</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 광고 적립 — 서버 app-config(ads.rewarded)가 활성일 때만 시청 가능, 아니면 준비중 */}
        {(() => {
          const adOn = rewarded.enabled && !!rewarded.adUnit;
          return card(
            <CardIcon kind="ad" />,
            '#fef1f2',
            '광고 적립',
            '하루 20회 · 회당 2캐시',
            adOn
              ? rewardBtn(adBusy ? '광고 불러오는 중...' : '2캐시', watchAd, adBusy || userId == null)
              : rewardBtn('준비중', undefined, true, true),
            adOn ? watchAd : undefined,
            !adOn,
          );
        })()}

        {/* 미션적립 (애드팝콘 오퍼월) — 이 빌드부터 활성 */}
        {card(
          <CardIcon kind="mission" />,
          '#e6f7fb',
          '미션적립',
          '미션 완료 시 지급',
          rewardBtn('최대 100,000캐시', openOfferwallCard, userId == null),
          openOfferwallCard,
        )}

        {/* SNS 채널 추가 보상 */}
        {!snsClaimed.kakao &&
          card(
            <CardIcon kind="kakao" />,
            '#FEE500',
            '카카오톡',
            '채널추가 · 최초 1회',
            rewardBtn(
              snsBusy === 'kakao' ? '적립 중...' : '50캐시',
              () => claimSns('kakao', SNS_KAKAO_URL),
              snsBusy !== null,
            ),
            () => claimSns('kakao', SNS_KAKAO_URL),
          )}
        {!snsClaimed.instagram &&
          card(
            <CardIcon kind="insta" />,
            '#fdf2f8',
            '인스타그램',
            '팔로우 · 최초 1회',
            rewardBtn(
              snsBusy === 'instagram' ? '적립 중...' : '50캐시',
              () => claimSns('instagram', SNS_INSTAGRAM_URL),
              snsBusy !== null,
            ),
            () => claimSns('instagram', SNS_INSTAGRAM_URL),
          )}

        {/* 버그/개선 · 리뷰쓰기 (안내 모달 → 카톡 채널) */}
        {card(
          <CardIcon kind="bug" />,
          '#f3efff',
          '버그/개선',
          '제보 채택 시 지급',
          rewardBtn('최대 2,000캐시', () => setMission('bug')),
          () => setMission('bug'),
        )}
        {card(
          <CardIcon kind="review" />,
          '#fff7e6',
          '리뷰쓰기',
          '최초 1회',
          rewardBtn('200캐시', () => setMission('review')),
          () => setMission('review'),
        )}

        {!!snsToast && <Text style={styles.toast}>{snsToast}</Text>}
      </ScrollView>
      <WebBottomNav />

      {/* 미션 안내 모달 */}
      <Modal visible={mission !== null} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setMission(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            {mission !== null && (
              <>
                <View style={[styles.modalIcon, { backgroundColor: mission === 'bug' ? '#f3efff' : '#fff7e6' }]}>
                  <CardIcon kind={mission} />
                </View>
                <Text style={styles.modalTitle}>{MISSIONS[mission].title}</Text>
                <Text style={styles.modalReward}>{MISSIONS[mission].reward}</Text>
                <Text style={styles.modalDesc}>{MISSIONS[mission].desc}</Text>
                <Pressable
                  style={styles.modalCta}
                  onPress={() => {
                    haptics.tap();
                    Linking.openURL(SNS_KAKAO_URL).catch(() => {});
                    setMission(null);
                  }}
                >
                  <Text style={styles.modalCtaText}>{MISSIONS[mission].cta}</Text>
                </Pressable>
                <Pressable style={styles.modalClose} onPress={() => setMission(null)} hitSlop={8}>
                  <Text style={styles.modalCloseText}>닫기</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
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
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 10 },
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
  cardSoon: { opacity: 0.6 },
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
  soonBadge: { fontSize: 11, fontWeight: '700', color: '#94a3b8' },
  cardDesc: { fontSize: 12.5, color: '#8b95a1', marginTop: 2 },
  cardBtn: {
    backgroundColor: '#3182f6',
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  cardBtnGhost: { backgroundColor: '#f2f4f6' },
  cardBtnText: { fontSize: 12.5, fontWeight: '800', color: '#ffffff' },
  cardBtnTextGhost: { color: '#94a3b8' },
  toast: { textAlign: 'center', color: '#059669', fontSize: 13.5, fontWeight: '700', marginTop: 6 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  modalCard: {
    alignSelf: 'stretch',
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 26,
    alignItems: 'center',
  },
  modalIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a' },
  modalReward: { fontSize: 13.5, fontWeight: '800', color: '#2272eb', marginTop: 4 },
  modalDesc: { fontSize: 13.5, color: '#4e5968', lineHeight: 21, marginTop: 12, textAlign: 'center' },
  modalCta: {
    alignSelf: 'stretch',
    backgroundColor: '#FEE500',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 18,
  },
  modalCtaText: { fontSize: 15, fontWeight: '800', color: '#3A1D1D' },
  modalClose: { marginTop: 12 },
  modalCloseText: { fontSize: 14, fontWeight: '700', color: '#8b95a1' },
});
