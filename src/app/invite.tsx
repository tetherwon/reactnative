import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';

import WebBottomNav from '@/components/WebBottomNav';
import { apiFetch, ApiError, apiFetchSWR, BASE_URL } from '@/lib/api';
import * as haptics from '@/lib/haptics';

// 웹 /invite 의 네이티브 구현 — 새 웹 디자인(히어로/혜택 카드/스텝/파란 밴드) 반영.
// 공유는 네이티브 공유 시트(Share API).

type Referral = {
  referral_code?: string;
  referred_count?: number;
  earnings?: number;
  referred?: boolean;
};
type Friend = { name?: string; masked?: string; email?: string; created_at?: number; status?: string };

const GOAL = 5;
const GIFT_URI = `${BASE_URL}/static/logos/invite-gift.png`;

// 웹 혜택 안내 SVG 아이콘 3종 (money bag / shopping bag / gift) 그대로 재현
function IconMoneyBag() {
  return (
    <Svg width={28} height={28} viewBox="0 0 32 32">
      <Path d="M10.6 5.1c-.4-.7.1-1.6.9-1.6h9c.8 0 1.3.9.9 1.6L19 9.4h-6z" fill="#FCD34D" />
      <Path
        d="M13 9c-3.3 2.7-5.6 6.5-5.6 10.6A6.6 6.6 0 0 0 14 26.2h4a6.6 6.6 0 0 0 6.6-6.6C24.6 15.5 22.3 11.7 19 9z"
        fill="#FBBF24"
      />
      <SvgText x={16} y={22} fontSize={11} fontWeight="800" fill="#fff" textAnchor="middle">
        $
      </SvgText>
    </Svg>
  );
}
function IconShoppingBag() {
  return (
    <Svg width={28} height={28} viewBox="0 0 32 32">
      <Path d="M11.5 10.7V9a4.5 4.5 0 0 1 9 0v1.7" stroke="#2E6BF0" strokeWidth={2.3} strokeLinecap="round" fill="none" />
      <Path d="M7.4 10.5h17.2l-1.3 14.3a2.1 2.1 0 0 1-2.1 1.9H10.8a2.1 2.1 0 0 1-2.1-1.9z" fill="#3B82F6" />
    </Svg>
  );
}
function IconGift() {
  return (
    <Svg width={28} height={28} viewBox="0 0 32 32">
      <Rect x={6.5} y={13} width={19} height={12.6} rx={1.6} fill="#EF4444" />
      <Rect x={5.4} y={9.5} width={21.2} height={4.9} rx={1.4} fill="#F87171" />
      <Rect x={14.3} y={9.5} width={3.4} height={16.1} fill="#FECDD3" />
      <Path d="M16 9.5C15 7 12.5 6.1 11 7.4c-1.7 1.4-.3 3.1 5 2.1z" fill="#FCA5A5" />
      <Path d="M16 9.5C17 7 19.5 6.1 21 7.4c1.7 1.4.3 3.1-5 2.1z" fill="#FCA5A5" />
    </Svg>
  );
}

export default function InviteScreen() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<Referral | null>(null);
  const [refInput, setRefInput] = useState('');
  const [refMsg, setRefMsg] = useState('');
  const [refBusy, setRefBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [friends, setFriends] = useState<Friend[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      apiFetchSWR<Referral>('/api/referral/me', (d) => {
        if (alive) setData(d);
      }).catch((e) => {
        if (alive && e instanceof ApiError && e.status === 401) router.back();
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  const code = data?.referral_code || '';
  const count = Number(data?.referred_count || 0);
  const link = `${BASE_URL}/invite/go?ref=${code}&utm_source=invite`;
  const shareBody = `쇼핑로그 신규가입하고 1,000캐시 + 룰렛 티켓 2장 받아요.\n${link}${code ? `\n추천코드 : ${code}` : ''}`;

  const doShare = () => {
    if (!code) return;
    haptics.tap();
    Share.share({ message: shareBody, title: '쇼핑로그' }).catch(() => {});
  };

  const copyCode = async () => {
    if (!code) return;
    haptics.tap();
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const submitReferrer = () => {
    const v = refInput.trim();
    if (!v || refBusy) return;
    haptics.tap();
    setRefBusy(true);
    setRefMsg('');
    apiFetch<{ ok?: boolean }>('/api/referral/apply', {
      method: 'POST',
      body: JSON.stringify({ code: v }),
    })
      .then(() => {
        haptics.success();
        setRefMsg('추천인이 등록됐어요!');
        setData((d) => (d ? { ...d, referred: true } : d));
      })
      .catch((e) => {
        haptics.error();
        setRefMsg(e instanceof ApiError ? e.message : '등록에 실패했어요. 코드를 확인해주세요.');
      })
      .finally(() => setRefBusy(false));
  };

  const openFriends = () => {
    haptics.tap();
    setFriendsOpen(true);
    if (friends === null) {
      apiFetch<{ users?: Friend[] }>('/api/referral/list')
        .then((d) => setFriends(d.users || []))
        .catch(() => setFriends([]));
    }
  };

  // 초대 챌린지 진행률 (웹 로직 그대로)
  const within = count % GOAL;
  const doneN = within === 0 && count > 0 ? GOAL : within;
  const remain = within === 0 ? GOAL : GOAL - within;

  const benefits = [
    { icon: <IconMoneyBag />, text: '친구가 첫 구매 시 즉시 적립', value: '300캐시' },
    { icon: <IconShoppingBag />, text: '친구 쇼핑의 자동 적립', value: '10%', sub: '1년간 유지' },
    { icon: <IconGift />, text: '5명 초대마다 보너스', value: '500캐시' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>친구 초대</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* 히어로 */}
        <View style={styles.hero}>
          <Image source={{ uri: GIFT_URI }} style={styles.heroImg} contentFit="contain" />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              친구가 쇼핑하면 나도 <Text style={styles.badgeHi}>10% 적립</Text>
            </Text>
          </View>
          <View style={styles.badgeTail} />
          <Text style={styles.heroTitle}>
            친구 초대하고{'\n'}
            <Text style={styles.accent}>추가 캐시</Text> 받아요
          </Text>
          <Text style={styles.heroSub}>친구가 쇼핑하면 나도 10% 적립</Text>
        </View>

        {/* 내 초대 코드 + 통계 (통합 카드) */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>내 초대 코드</Text>
          <View style={styles.codeRow}>
            <Text style={styles.codeText} numberOfLines={1}>
              {code || '코드 로딩 중...'}
            </Text>
            <Pressable style={styles.copyBtn} onPress={copyCode} hitSlop={6}>
              <Text style={styles.copyBtnText}>{copied ? '완료' : '복사'}</Text>
            </Pressable>
          </View>
          <View style={styles.dashed} />
          <View style={styles.statsRow}>
            <Pressable style={styles.stat} onPress={openFriends}>
              <Text style={styles.statValue}>{count}</Text>
              <Text style={[styles.statLabel, styles.statLabelActive]}>초대한 친구</Text>
            </Pressable>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{count}</Text>
              <Text style={styles.statLabel}>받은 티켓</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{Number(data?.earnings || 0).toLocaleString('ko-KR')}</Text>
              <Text style={styles.statLabel}>받은 캐시</Text>
            </View>
          </View>
        </View>

        {count === 0 && (
          <Text style={styles.nudge}>
            아직 초대한 친구가 없어요.{'\n'}
            <Text style={styles.accent}>아래 버튼</Text>으로 첫 친구를 초대해 보세요.
          </Text>
        )}

        {/* 혜택 안내 — 연파랑 밴드 + 흰 카드 */}
        <View style={styles.benefit}>
          <Text style={styles.benefitTitle}>혜택 안내</Text>
          {benefits.map((b, i) => (
            <View key={i} style={styles.bRow}>
              <View style={styles.bIcon}>{b.icon}</View>
              <Text style={styles.bText}>{b.text}</Text>
              <View style={styles.bValueWrap}>
                <Text style={styles.bValue}>{b.value}</Text>
                {b.sub ? <Text style={styles.bSub}>{b.sub}</Text> : null}
              </View>
            </View>
          ))}
        </View>

        {/* 초대 챌린지 — 1~5 스텝 */}
        <View style={styles.milestone}>
          <View style={styles.mHead}>
            <Text style={styles.mTitle}>초대 챌린지</Text>
            <Text style={styles.mCount}>
              <Text style={styles.mCountB}>{doneN}</Text>/{GOAL}
            </Text>
          </View>
          <Text style={styles.mSub}>
            {count === 0 ? '친구 5명 초대에 도전해 보세요.' : `${remain}명 더 초대하면 다음 단계 달성`}
          </Text>
          <View style={styles.steps}>
            {[1, 2, 3, 4, 5].map((s, i) => {
              const done = i < doneN;
              const goal = s === 5;
              return (
                <View key={s} style={styles.stepCell}>
                  {i > 0 && <View style={[styles.stepLine, i <= doneN && styles.stepLineOn]} />}
                  <View style={[styles.stepDot, done && styles.stepDotDone, goal && !done && styles.stepDotGoal]}>
                    {goal && (
                      <View style={styles.stepBadge}>
                        <Text style={styles.stepBadgeText}>500캐시</Text>
                      </View>
                    )}
                    <Text style={[styles.stepNum, done && styles.stepNumOn, goal && !done && styles.stepNumGoal]}>
                      {s}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
          <Text style={styles.mGoal}>
            5명 달성 시 <Text style={styles.mGoalB}>500캐시</Text> 보너스 지급
          </Text>
        </View>

        {/* 추천인 코드 입력 (미등록자만) — 연파랑 밴드 */}
        {data !== null && !data.referred && (
          <View style={styles.refCard}>
            <Text style={styles.refTitle}>추천인 코드가 있나요?</Text>
            <Text style={styles.refDesc}>
              가입할 때 코드를 넣지 못했다면 아래에서 지금 등록하세요. 등록 후에는 변경할 수 없어요.
            </Text>
            <View style={styles.refRow}>
              <TextInput
                style={styles.refInput}
                placeholder="추천인 코드 입력"
                placeholderTextColor="#8b95a1"
                value={refInput}
                onChangeText={setRefInput}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={16}
              />
              <Pressable
                style={[styles.refBtn, (refBusy || !refInput.trim()) && { opacity: 0.5 }]}
                onPress={submitReferrer}
                disabled={refBusy || !refInput.trim()}
              >
                <Text style={styles.refBtnText}>{refBusy ? '등록 중…' : '등록'}</Text>
              </Pressable>
            </View>
            {!!refMsg && (
              <Text style={[styles.refMsg, !refMsg.includes('!') && styles.refMsgError]}>{refMsg}</Text>
            )}
          </View>
        )}

        {/* 적립·환불 규정 */}
        <Text style={styles.sectionTitle}>적립·환불 규정</Text>
        <View style={styles.policyList}>
          {[
            '리워드(티켓·적립금)는 친구의 구매가 확정된 시점에 지급됩니다. 주문 직후가 아니라 반품·교환 기간이 끝난 뒤 확정됩니다.',
            '친구가 주문을 취소·반품·환불하면 해당 건의 적립과 추천 보너스(적립금의 10%)는 지급되지 않습니다.',
            '이미 지급된 적립금·보너스도 이후 환불이 확인되면 회수(차감)될 수 있습니다.',
            '추천 보너스 10%는 친구 가입일로부터 1년간 유지됩니다.',
            '5명 초대 보너스(500캐시)는 첫 구매가 확정된 친구(유효 초대) 5명마다 지급되며, 단순 가입만으로는 집계되지 않습니다.',
            '자기 추천, 반복 취소, 비정상 거래 등 어뷰징이 확인되면 적립이 취소되고 계정 이용이 제한될 수 있습니다.',
          ].map((t, i) => (
            <Text key={i} style={styles.policyItem}>
              · {t}
            </Text>
          ))}
        </View>
      </ScrollView>

      {/* 하단 고정 공유 버튼 (네비 위) — WebBottomNav 실제 높이(60 + 안전영역)만큼 띄운다 */}
      <View style={[styles.shareBar, { bottom: 60 + insets.bottom }]}>
        <Pressable style={styles.shareBtn} onPress={doShare}>
          <Text style={styles.shareBtnText}>친구에게 공유하기</Text>
        </Pressable>
      </View>

      <WebBottomNav />

      {/* 초대한 친구 모달 */}
      <Modal visible={friendsOpen} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>초대한 친구</Text>
              <Pressable onPress={() => setFriendsOpen(false)} hitSlop={10}>
                <Text style={styles.modalCloseX}>✕</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalList}>
              {friends === null ? (
                <Text style={styles.modalEmpty}>불러오는 중...</Text>
              ) : friends.length === 0 ? (
                <Text style={styles.modalEmpty}>아직 초대한 친구가 없어요.</Text>
              ) : (
                friends.map((f, i) => (
                  <View key={i} style={styles.friendRow}>
                    <Text style={styles.friendName}>{f.masked || f.name || f.email || '친구'}</Text>
                    {!!f.created_at && (
                      <Text style={styles.friendDate}>
                        {new Date(f.created_at * 1000).toLocaleDateString('ko-KR')}
                      </Text>
                    )}
                  </View>
                ))
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
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 90 },

  hero: { alignItems: 'center', paddingBottom: 6 },
  heroImg: { width: 128, height: 112, marginBottom: 16 },
  badge: { backgroundColor: '#263041', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  badgeText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  badgeHi: { color: '#ffd43b', fontWeight: '800' },
  badgeTail: {
    width: 0,
    height: 0,
    marginBottom: 12,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#263041',
  },
  heroTitle: { fontSize: 27, fontWeight: '800', color: '#191f28', textAlign: 'center', lineHeight: 35 },
  accent: { color: '#3182f6' },
  heroSub: { marginTop: 10, fontSize: 15, color: '#8b95a1', fontWeight: '500' },

  card: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e8eb',
    borderRadius: 18,
    padding: 20,
  },
  cardLabel: { fontSize: 11, fontWeight: '700', color: '#8b95a1', letterSpacing: 0.4, marginBottom: 10 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  codeText: { flex: 1, fontSize: 26, fontWeight: '800', color: '#3182f6' },
  copyBtn: { borderWidth: 1, borderColor: '#d1d6db', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 9 },
  copyBtnText: { fontSize: 13.5, fontWeight: '700', color: '#4e5968' },
  dashed: { height: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#dfe3e8', marginVertical: 18 },
  statsRow: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center', gap: 6 },
  statValue: { fontSize: 24, fontWeight: '800', color: '#191f28' },
  statLabel: { fontSize: 12.5, color: '#8b95a1' },
  statLabelActive: { color: '#3182f6', fontWeight: '700' },

  nudge: { marginTop: 14, textAlign: 'center', fontSize: 13.5, lineHeight: 22, fontWeight: '600', color: '#4e5968' },

  benefit: { marginTop: 18, marginHorizontal: -16, paddingHorizontal: 16, paddingVertical: 22, backgroundColor: '#eef2fc' },
  benefitTitle: { fontSize: 18, fontWeight: '800', color: '#191f28', marginBottom: 14 },
  bRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  bIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f2f5fb', alignItems: 'center', justifyContent: 'center' },
  bText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#191f28' },
  bValueWrap: { alignItems: 'flex-end' },
  bValue: { fontSize: 20, fontWeight: '800', color: '#3182f6' },
  bSub: { fontSize: 12, color: '#8b95a1', marginTop: 3 },

  milestone: { marginTop: 28, marginBottom: 4 },
  mHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  mTitle: { fontSize: 16, fontWeight: '800', color: '#191f28' },
  mCount: { fontSize: 15, color: '#8b95a1' },
  mCountB: { fontWeight: '800', color: '#3182f6' },
  mSub: { fontSize: 13.5, color: '#8b95a1', fontWeight: '500' },
  steps: { flexDirection: 'row', alignItems: 'center', marginTop: 44, marginBottom: 16, paddingHorizontal: 24 },
  stepCell: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  stepLine: { flex: 1, height: 3, backgroundColor: '#eceef1', marginHorizontal: 2, borderRadius: 2 },
  stepLineOn: { backgroundColor: '#3182f6' },
  stepDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: '#e5e8eb',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: '#3182f6', borderColor: '#3182f6' },
  stepDotGoal: { borderColor: '#3182f6' },
  stepNum: { fontSize: 15, fontWeight: '700', color: '#b0b8c1' },
  stepNumOn: { color: '#fff' },
  stepNumGoal: { color: '#3182f6' },
  stepBadge: { position: 'absolute', bottom: 44, backgroundColor: '#2b3441', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  stepBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  mGoal: { textAlign: 'center', fontSize: 13.5, color: '#8b95a1', fontWeight: '500' },
  mGoalB: { color: '#4e5968', fontWeight: '800' },

  refCard: { marginTop: 20, marginHorizontal: -16, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 26, backgroundColor: '#eff4ff' },
  refTitle: { fontSize: 18, fontWeight: '800', color: '#191f28', marginBottom: 8 },
  refDesc: { fontSize: 13.5, color: '#8b95a1', lineHeight: 21, marginBottom: 16 },
  refRow: { flexDirection: 'row', gap: 8 },
  refInput: {
    flex: 1,
    height: 50,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d6e0f0',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#191f28',
  },
  refBtn: { minWidth: 76, height: 50, borderRadius: 12, backgroundColor: '#3182f6', alignItems: 'center', justifyContent: 'center' },
  refBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  refMsg: { fontSize: 12.5, fontWeight: '700', color: '#059669', marginTop: 10 },
  refMsgError: { color: '#dc2626' },

  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#191f28', marginTop: 22, marginBottom: 10 },
  policyList: { gap: 6 },
  policyItem: { fontSize: 12, color: '#8b95a1', lineHeight: 18 },

  shareBar: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8 },
  shareBtn: {
    height: 54,
    borderRadius: 999,
    backgroundColor: '#3182f6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3182f6',
    shadowOpacity: 0.36,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  shareBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '70%',
    paddingBottom: 24,
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  modalCloseX: { fontSize: 18, color: '#8b95a1' },
  modalList: { paddingHorizontal: 20 },
  modalEmpty: { fontSize: 13.5, color: '#8b95a1', paddingVertical: 24, textAlign: 'center' },
  friendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  friendName: { fontSize: 14, fontWeight: '700', color: '#334155' },
  friendDate: { fontSize: 12.5, color: '#8b95a1' },
});
