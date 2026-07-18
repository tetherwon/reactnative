import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import WebBottomNav from '@/components/WebBottomNav';
import { apiFetch, ApiError, apiFetchSWR, BASE_URL, clearToken, isNativeScreenEnabled } from '@/lib/api';
import * as haptics from '@/lib/haptics';
import { requestWebCommand, requestWebNav } from '@/lib/webNav';

// 웹 /profile(templates/profile.html)의 네이티브 구현 (본체만).
// 문의·비밀번호 변경·이름 수정·소셜 연동 등 하위 플로우는 웹뷰 프로필로 보낸다.
// 알림 설정은 API가 단순(토글 3개)해 네이티브 모달로 구현.

type Overview = { user?: { name?: string; email?: string; points?: number; provider?: string } };
type Referral = { referral_code?: string; referred_count?: number };
type GradeInfo = {
  grade?: string;
  grade_label?: string;
  next_tier?: string;
  next_tier_threshold?: number;
  monthly_total_amount?: number;
  monthly_confirmed_amount?: number;
  monthly_pending_amount?: number;
  amount_to_next_tier?: number;
  amount_to_next_tier_total?: number;
};
type NotifSettings = { checkin_reminder: boolean; daily_9am: boolean; game_time: boolean };

function openWeb(path: string) {
  haptics.tap();
  requestWebNav(path);
  router.dismissTo('/');
}

const GRADE_LABEL: Record<string, string> = { starter: '스타터', silver: '실버', gold: '골드' };
const GRADE_COLOR: Record<string, string> = { starter: '#64748b', silver: '#64748b', gold: '#b7791f' };

export default function ProfileScreen() {
  const [user, setUser] = useState<Overview['user'] | null>(null);
  const [referral, setReferral] = useState<Referral | null>(null);
  const [grade, setGrade] = useState<GradeInfo | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notif, setNotif] = useState<NotifSettings>({ checkin_reminder: false, daily_9am: false, game_time: false });
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifMsg, setNotifMsg] = useState('');

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      apiFetchSWR<Overview>('/api/me/overview', (d) => {
        if (alive && d.user) setUser(d.user);
      }).catch((e) => {
        if (alive && e instanceof ApiError && e.status === 401) router.back();
      });
      apiFetchSWR<Referral>('/api/referral/me', (d) => {
        if (alive) setReferral(d);
      }).catch(() => {});
      apiFetchSWR<GradeInfo>('/api/grade/info', (d) => {
        if (alive) setGrade(d);
      }).catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );

  const displayName = user?.name || (user?.email || '').split('@')[0] || '회원';

  const copyCode = async () => {
    if (!referral?.referral_code) return;
    haptics.tap();
    try {
      await Clipboard.setStringAsync(referral.referral_code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {}
  };

  // 등급 진행률 (웹 profile-inline-1.js 로직 그대로)
  const level = (() => {
    if (!grade) return null;
    if (grade.grade === 'gold') return { pct: 100, sub: '최고 등급입니다' };
    if (!grade.next_tier_threshold) return null;
    const prev = grade.grade === 'silver' ? 500000 : 0;
    const range = grade.next_tier_threshold - prev;
    const total =
      grade.monthly_total_amount != null
        ? grade.monthly_total_amount
        : (grade.monthly_confirmed_amount || 0) + (grade.monthly_pending_amount || 0);
    const pct = Math.min(100, Math.max(0, Math.round(((total - prev) / range) * 100)));
    const remain = (
      grade.amount_to_next_tier_total != null ? grade.amount_to_next_tier_total : grade.amount_to_next_tier || 0
    ).toLocaleString('ko-KR');
    const nextLabel = grade.next_tier === 'gold' ? '골드' : '실버';
    const pendingNote = (grade.monthly_pending_amount || 0) > 0 ? ' (적립 대기 포함)' : '';
    return { pct, sub: `${nextLabel} 등급까지 ${remain}원 남았어요${pendingNote}` };
  })();

  const openNotif = () => {
    haptics.tap();
    setNotifMsg('');
    setNotifOpen(true);
    apiFetch<NotifSettings>('/api/notification-settings')
      .then((d) =>
        setNotif({
          checkin_reminder: !!d.checkin_reminder,
          daily_9am: !!d.daily_9am,
          game_time: !!d.game_time,
        }),
      )
      .catch(() => {});
  };

  const saveNotif = () => {
    setNotifSaving(true);
    setNotifMsg('');
    apiFetch('/api/notification-settings', { method: 'POST', body: JSON.stringify(notif) })
      .then(() => {
        haptics.success();
        setNotifMsg('저장했어요.');
        setTimeout(() => setNotifOpen(false), 900);
      })
      .catch(() => {
        haptics.error();
        setNotifMsg('저장에 실패했어요. 잠시 후 다시 시도해 주세요.');
      })
      .finally(() => setNotifSaving(false));
  };

  const logout = () => {
    Alert.alert('로그아웃', '로그아웃할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: async () => {
          haptics.tap();
          await clearToken();
          requestWebCommand('logout'); // 웹뷰 쿠키 세션·캐시도 정리
          router.dismissTo('/');
        },
      },
    ]);
  };

  const menuRow = (label: string, onPress: () => void, danger = false) => (
    <Pressable
      key={label}
      style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
      onPress={onPress}
    >
      <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
      <Text style={styles.menuArrow}>›</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 프로필 카드 */}
        <View style={styles.card}>
          <View style={styles.idRow}>
            <Image
              source={{ uri: encodeURI(BASE_URL + '/static/profile.webp') }}
              style={styles.avatar}
              contentFit="cover"
            />
            <View style={styles.idInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{user === null ? '—' : `${displayName} 님`}</Text>
                {!!grade?.grade && (
                  <View style={styles.gradeBadge}>
                    <Text style={[styles.gradeBadgeText, { color: GRADE_COLOR[grade.grade] || '#64748b' }]}>
                      {grade.grade_label || GRADE_LABEL[grade.grade] || grade.grade}
                    </Text>
                  </View>
                )}
              </View>
              {!!referral?.referral_code && (
                <Pressable style={styles.codeRow} onPress={copyCode}>
                  <Text style={styles.codeLabel}>초대 코드</Text>
                  <View style={styles.codeChip}>
                    <Text style={styles.codeChipText}>
                      {codeCopied ? '복사됨!' : referral.referral_code}
                    </Text>
                  </View>
                </Pressable>
              )}
            </View>
          </View>
          {level !== null && (
            <View style={styles.levelBox}>
              <View style={styles.levelTop}>
                <Text style={styles.levelLabel}>다음 등급까지</Text>
                <Text style={styles.levelPct}>{level.pct}%</Text>
              </View>
              <View style={styles.levelTrack}>
                <View style={[styles.levelFill, { width: `${level.pct}%` }]} />
              </View>
              <Text style={styles.levelSub}>{level.sub}</Text>
            </View>
          )}
        </View>

        {/* 쇼핑·적립 */}
        <Text style={styles.sectionLabel}>쇼핑·적립</Text>
        <View style={styles.menuSection}>
          {menuRow('쿠폰함', () => openWeb('/coupons'))}
          {menuRow('캐시 내역', () => {
            if (isNativeScreenEnabled('my-purchases')) {
              haptics.tap();
              router.push('/my-purchases');
            } else openWeb('/my-purchases');
          })}
          {menuRow('캐시백 계산기', () => openWeb('/?tab=calc'))}
        </View>

        {/* 알림 · 고객센터 */}
        <Text style={styles.sectionLabel}>알림 · 고객센터</Text>
        <View style={styles.menuSection}>
          {menuRow('공지사항', () => openWeb('/notices'))}
          {menuRow('알림 설정', openNotif)}
          {menuRow('고객센터', () => {
            if (isNativeScreenEnabled('cs')) {
              haptics.tap();
              router.push('/cs');
            } else openWeb('/cs');
          })}
          {menuRow('문의하기 · 내 문의 내역', () => openWeb('/profile'))}
        </View>

        {/* 계정 */}
        <Text style={styles.sectionLabel}>계정</Text>
        <View style={styles.menuSection}>
          {user?.provider === 'email' && menuRow('계정 연동 · 비밀번호 변경', () => openWeb('/profile'))}
          {menuRow('로그아웃', logout)}
          {menuRow('회원 탈퇴', () => openWeb('/profile'), true)}
        </View>

        {/* 약관·정보 */}
        <View style={styles.legal}>
          {(
            [
              ['서비스 소개', '/service-intro'],
              ['이용약관', '/terms'],
              ['개인정보처리방침', '/privacy'],
              ['회사 정보', '/company'],
            ] as const
          ).map(([label, path]) => (
            <Pressable key={path} onPress={() => openWeb(path)} hitSlop={6}>
              <Text style={styles.legalLink}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <WebBottomNav active="profile" />

      {/* 알림 설정 모달 */}
      <Modal visible={notifOpen} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>알림 설정</Text>
            {(
              [
                ['checkin_reminder', '출석체크 알림', '저녁 8시, 출석 안 한 날만 알려드려요'],
                ['daily_9am', '매일 오전 9시 알림', '아침 적립 리마인더'],
                ['game_time', '게임 시간 알림', '준비 중인 알림이에요'],
              ] as const
            ).map(([key, label, sub]) => (
              <View key={key} style={styles.notifRow}>
                <View style={styles.notifInfo}>
                  <Text style={styles.notifLabel}>{label}</Text>
                  <Text style={styles.notifSub}>{sub}</Text>
                </View>
                <Switch
                  value={notif[key]}
                  onValueChange={(v) => setNotif((n) => ({ ...n, [key]: v }))}
                  trackColor={{ true: '#3182f6', false: '#e5e8eb' }}
                  thumbColor="#ffffff"
                />
              </View>
            ))}
            {!!notifMsg && (
              <Text style={[styles.notifMsg, notifMsg.includes('실패') && styles.notifMsgError]}>
                {notifMsg}
              </Text>
            )}
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalBtnGhost]} onPress={() => setNotifOpen(false)}>
                <Text style={styles.modalBtnGhostText}>닫기</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnPrimary, notifSaving && { opacity: 0.6 }]}
                onPress={saveNotif}
                disabled={notifSaving}
              >
                <Text style={styles.modalBtnPrimaryText}>{notifSaving ? '저장 중…' : '저장하기'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f5f9' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
  },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  idInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  gradeBadge: {
    backgroundColor: '#f1f5f9',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  gradeBadgeText: { fontSize: 11.5, fontWeight: '800' },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  codeLabel: { fontSize: 12, color: '#8b95a1', fontWeight: '600' },
  codeChip: {
    backgroundColor: '#eff4ff',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  codeChipText: { fontSize: 12.5, fontWeight: '800', color: '#2272eb', letterSpacing: 0.4 },
  levelBox: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 14 },
  levelTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 },
  levelLabel: { fontSize: 12.5, fontWeight: '700', color: '#4e5968' },
  levelPct: { fontSize: 12.5, fontWeight: '800', color: '#2563eb' },
  levelTrack: { height: 8, borderRadius: 4, backgroundColor: '#eef0f3', overflow: 'hidden' },
  levelFill: { height: 8, borderRadius: 4, backgroundColor: '#3182f6' },
  levelSub: { fontSize: 12.5, color: '#64748b', marginTop: 8 },
  sectionLabel: { fontSize: 12.5, fontWeight: '700', color: '#8b95a1', marginBottom: 6, marginLeft: 4 },
  menuSection: { backgroundColor: '#ffffff', borderRadius: 16, marginBottom: 16, overflow: 'hidden' },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  menuRowPressed: { backgroundColor: '#f8fafc' },
  menuLabel: { fontSize: 14.5, fontWeight: '600', color: '#1e293b' },
  menuLabelDanger: { color: '#e42939' },
  menuArrow: { fontSize: 18, color: '#cbd5e1' },
  legal: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 4 },
  legalLink: { fontSize: 12.5, color: '#8b95a1' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 34,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    gap: 12,
  },
  notifInfo: { flex: 1 },
  notifLabel: { fontSize: 14.5, fontWeight: '700', color: '#1e293b' },
  notifSub: { fontSize: 12, color: '#8b95a1', marginTop: 2 },
  notifMsg: { fontSize: 13, fontWeight: '700', color: '#22c55e', marginTop: 6 },
  notifMsgError: { color: '#ef4444' },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  modalBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  modalBtnGhost: { backgroundColor: '#f1f5f9' },
  modalBtnGhostText: { color: '#334155', fontSize: 15, fontWeight: '800' },
  modalBtnPrimary: { backgroundColor: '#3182f6' },
  modalBtnPrimaryText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
});
