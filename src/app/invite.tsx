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
import { SafeAreaView } from 'react-native-safe-area-context';

import WebBottomNav from '@/components/WebBottomNav';
import { apiFetch, ApiError, apiFetchSWR, BASE_URL } from '@/lib/api';
import * as haptics from '@/lib/haptics';

// 웹 /invite(static/invite-inline-1/2.js)의 네이티브 구현.
// 공유는 네이티브 공유 시트(Share API) — 웹 navigator.share 보다 안정적.

type Referral = {
  referral_code?: string;
  referred_count?: number;
  earnings?: number;
  referred?: boolean;
};
type Friend = { name?: string; masked?: string; email?: string; created_at?: number; status?: string };

const GOAL = 5;

export default function InviteScreen() {
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
  const link = `${BASE_URL}/invite/go?ref=${code}`;
  // 웹 shareBody() 문구 그대로
  const shareBody = `쇼핑로그 신규가입하고 1000캐시 받아요.\n${link}\n추천코드 : ${code}`;

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
  const milestoneCount = within === 0 && count > 0 ? GOAL : within;
  const pct = Math.round(((count === 0 ? 0 : within === 0 ? GOAL : within) / GOAL) * 100);
  const remain = within === 0 ? GOAL : GOAL - within;

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
        {/* 내 초대 코드 + 공유 */}
        <View style={styles.linkCard}>
          <Text style={styles.linkLabel}>내 초대 코드</Text>
          <View style={styles.linkRow}>
            <Text style={styles.linkCode}>{code || '코드 로딩 중...'}</Text>
            <Pressable style={styles.copyBtn} onPress={copyCode} hitSlop={6}>
              <Text style={styles.copyBtnText}>{copied ? '완료' : '복사'}</Text>
            </Pressable>
          </View>
          <Pressable style={styles.shareBtn} onPress={doShare}>
            <Text style={styles.shareBtnText}>친구에게 공유하기</Text>
          </Pressable>
        </View>

        {/* 실적 3종 */}
        <View style={styles.statsRow}>
          <Pressable style={styles.statCard} onPress={openFriends}>
            <Text style={styles.statValue}>{count}</Text>
            <Text style={styles.statLabel}>초대한 친구</Text>
          </Pressable>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{count}</Text>
            <Text style={styles.statLabel}>받은 티켓</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{Number(data?.earnings || 0).toLocaleString('ko-KR')}</Text>
            <Text style={styles.statLabel}>받은 캐시</Text>
          </View>
        </View>
        {count === 0 && (
          <Text style={styles.nudge}>아직 초대한 친구가 없어요. 위 버튼으로 첫 친구를 초대해 보세요.</Text>
        )}

        {/* 초대 챌린지 */}
        <View style={styles.milestone}>
          <View style={styles.milestoneHead}>
            <Text style={styles.milestoneTitle}>초대 챌린지</Text>
            <Text style={styles.milestoneCount}>
              <Text style={styles.milestoneCountB}>{milestoneCount}</Text>/{GOAL}
            </Text>
          </View>
          <Text style={styles.milestoneSub}>
            {count === 0 ? '친구 5명 초대에 도전해 보세요.' : `${remain}명만 더 초대하면 보너스!`}
          </Text>
          <View style={styles.milestoneTrack}>
            <View style={[styles.milestoneFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.milestoneBonus}>
            5명 달성 시 <Text style={styles.milestoneBonusB}>500캐시</Text> 보너스 지급
          </Text>
        </View>

        {/* 추천인 코드 입력 (미등록자만) */}
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

        {/* 혜택 안내 (웹 invite.html 구조 그대로 — 아이콘 이미지 + 배지, 이모지 X) */}
        <Text style={styles.sectionTitle}>혜택 안내</Text>
        <View style={styles.benefitList}>
          <View style={[styles.benefitRow, styles.benefitRowBorder]}>
            <View style={styles.benefitIcon}>
              <Image
                source={{ uri: encodeURI(BASE_URL + '/static/logos/flow/reward.webp') }}
                style={styles.benefitIconImg}
                contentFit="contain"
              />
            </View>
            <Text style={styles.benefitText}>
              친구가 첫 구매 시 <Text style={styles.benefitStrong}>300캐시</Text> 즉시 적립
            </Text>
          </View>
          <View style={[styles.benefitRow, styles.benefitRowBorder]}>
            <View style={styles.benefitIcon}>
              <Image
                source={{ uri: encodeURI(BASE_URL + '/static/shopping.webp') }}
                style={styles.benefitIconImg}
                contentFit="contain"
              />
            </View>
            <Text style={styles.benefitText}>
              친구 쇼핑의 <Text style={styles.benefitStrong}>10%</Text> 자동 적립
            </Text>
            <Text style={styles.benefitBadge}>1년간 유지</Text>
          </View>
          <View style={styles.benefitRow}>
            <View style={styles.benefitIcon}>
              <Image
                source={{ uri: encodeURI(BASE_URL + '/static/logos/트로피.webp') }}
                style={styles.benefitIconImg}
                contentFit="contain"
              />
            </View>
            <Text style={styles.benefitText}>
              5명 초대마다 <Text style={styles.benefitStrong}>500캐시</Text> 보너스
            </Text>
          </View>
        </View>

        {/* 적립·환불 규정 (웹 문구 그대로) */}
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
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  linkCard: {
    backgroundColor: '#3182f6',
    borderRadius: 18,
    padding: 20,
    marginBottom: 12,
  },
  linkLabel: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.85)', marginBottom: 8 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  linkCode: { flex: 1, fontSize: 18, fontWeight: '800', color: '#ffffff', letterSpacing: 1 },
  copyBtn: { backgroundColor: '#ffffff', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7 },
  copyBtnText: { fontSize: 12.5, fontWeight: '800', color: '#2272eb' },
  shareBtn: {
    marginTop: 12,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  shareBtnText: { fontSize: 15, fontWeight: '800', color: '#2272eb' },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  statCard: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: { fontSize: 20, fontWeight: '900', color: '#191f28' },
  statLabel: { fontSize: 12, color: '#8b95a1', marginTop: 3 },
  nudge: { fontSize: 12.5, color: '#8b95a1', textAlign: 'center', marginBottom: 10 },
  milestone: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eef0f4',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  milestoneHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  milestoneTitle: { fontSize: 14.5, fontWeight: '800', color: '#191f28' },
  milestoneCount: { fontSize: 13, color: '#8b95a1' },
  milestoneCountB: { fontWeight: '900', color: '#2272eb' },
  milestoneSub: { fontSize: 12.5, color: '#8b95a1', marginBottom: 10 },
  milestoneTrack: { height: 8, borderRadius: 4, backgroundColor: '#eef0f3', overflow: 'hidden' },
  milestoneFill: { height: 8, borderRadius: 4, backgroundColor: '#3182f6' },
  milestoneBonus: { fontSize: 12.5, color: '#4e5968', marginTop: 10 },
  milestoneBonusB: { fontWeight: '900', color: '#2272eb' },
  refCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  refTitle: { fontSize: 14.5, fontWeight: '800', color: '#191f28' },
  refDesc: { fontSize: 12.5, color: '#8b95a1', marginTop: 4, lineHeight: 18 },
  refRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  refInput: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e8eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#191f28',
  },
  refBtn: {
    backgroundColor: '#3182f6',
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  refBtnText: { fontSize: 14, fontWeight: '800', color: '#ffffff' },
  refMsg: { fontSize: 12.5, fontWeight: '700', color: '#059669', marginTop: 8 },
  refMsgError: { color: '#dc2626' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#191f28', marginTop: 14, marginBottom: 8 },
  benefitList: { marginBottom: 4 },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  benefitRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f2f4f6' },
  benefitIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitIconImg: { width: 28, height: 28 },
  benefitText: { flex: 1, fontSize: 15, color: '#4e5968', lineHeight: 21 },
  benefitStrong: { color: '#191f28', fontWeight: '700' },
  benefitBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
    backgroundColor: '#8b95a1',
    borderRadius: 10,
    paddingVertical: 4,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  policyList: { gap: 6 },
  policyItem: { fontSize: 12, color: '#8b95a1', lineHeight: 18 },
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
