/**
 * 네이티브 친구초대 화면 (하이브리드). 웹 /invite 디자인·API를 네이티브로 옮긴 것.
 * 관리자에서 native_screens에 'invite'가 켜져 있으면 index.tsx가 웹뷰 대신 이 화면을
 * 띄운다(꺼지면 웹뷰로 롤백). 인증은 nativeState의 미러링된 JWT(Bearer)를 쓴다.
 */
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as haptics from '@/lib/haptics';
import { API_BASE, getNativeToken } from '@/lib/nativeState';

const GIFT_URI = `${API_BASE}/static/logos/invite-gift.png`;
const GOAL = 5;

type Me = {
  referral_code: string;
  referred_count: number;
  earnings: number;
  referred: boolean;
};

function notify(msg: string) {
  if (ToastAndroid && ToastAndroid.show) ToastAndroid.show(msg, ToastAndroid.SHORT);
}

async function authFetch(path: string, init?: RequestInit) {
  const token = await getNativeToken();
  const headers: Record<string, string> = { Accept: 'application/json', ...(init?.headers as any) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(API_BASE + path, { ...init, headers });
}

export default function InviteScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [refInput, setRefInput] = useState('');
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/referral/me');
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      if (res.ok) {
        const d = await res.json();
        setAuthed(true);
        setMe({
          referral_code: String(d.referral_code || ''),
          referred_count: Number(d.referred_count || 0),
          earnings: Number(d.earnings || 0),
          referred: Boolean(d.referred),
        });
      }
    } catch {
      // 네트워크 오류 — 빈 상태 유지
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const code = me?.referral_code || '';
  const link = code ? `${API_BASE}/invite/go?ref=${encodeURIComponent(code)}&utm_source=invite` : '';
  const n = me?.referred_count || 0;
  const within = n % GOAL;
  const doneN = within === 0 && n > 0 ? GOAL : within;

  const shareBody = [
    '쇼핑로그 신규가입하고 1,000캐시 + 룰렛 티켓 2장 받아요.',
    link,
    code ? `추천코드 : ${code}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const onCopy = useCallback(async () => {
    if (!code) return;
    try {
      await Clipboard.setStringAsync(code);
      haptics.success();
      notify('초대 코드가 복사됐어요!');
    } catch {
      // 무시
    }
  }, [code]);

  const onShare = useCallback(async () => {
    if (!shareBody) return;
    try {
      await Share.share({ message: shareBody });
    } catch {
      // 사용자가 시트를 닫음 등 — 무시
    }
  }, [shareBody]);

  const onApply = useCallback(async () => {
    const c = refInput.trim();
    if (!c || applying) return;
    setApplying(true);
    try {
      const res = await authFetch('/api/referral/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: c }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        haptics.success();
        notify('추천인 코드가 등록됐어요!');
        setRefInput('');
        load();
      } else {
        notify(d.detail || '유효하지 않은 추천인 코드예요.');
      }
    } catch {
      notify('네트워크 오류예요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setApplying(false);
    }
  }, [refInput, applying, load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* 상단 바 */}
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle}>친구 초대</Text>
        <View style={styles.back} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#3182f6" />
        </View>
      ) : !authed ? (
        <View style={styles.center}>
          <Text style={styles.loginText}>로그인하면 내 초대 링크를 확인할 수 있어요.</Text>
          <Pressable style={styles.loginBtn} onPress={() => router.back()}>
            <Text style={styles.loginBtnText}>돌아가기</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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

            {/* 초대 코드 카드 */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>내 초대 코드</Text>
              <View style={styles.codeRow}>
                <Text style={styles.codeText} numberOfLines={1}>
                  {code || '—'}
                </Text>
                <Pressable style={styles.copyBtn} onPress={onCopy}>
                  <Text style={styles.copyBtnText}>복사</Text>
                </Pressable>
              </View>
              <View style={styles.dashed} />
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{n}</Text>
                  <Text style={[styles.statLabel, styles.statLabelActive]}>초대한 친구</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{n}</Text>
                  <Text style={styles.statLabel}>받은 티켓</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{(me?.earnings || 0).toLocaleString()}</Text>
                  <Text style={styles.statLabel}>받은 캐시</Text>
                </View>
              </View>
            </View>

            {n === 0 && (
              <Text style={styles.nudge}>
                아직 초대한 친구가 없어요.{'\n'}
                <Text style={styles.accent}>아래 버튼</Text>으로 첫 친구를 초대해 보세요.
              </Text>
            )}

            {/* 혜택 안내 */}
            <View style={styles.benefit}>
              <Text style={styles.benefitTitle}>혜택 안내</Text>
              {[
                { ic: '💰', t: '친구가 첫 구매 시 즉시 적립', v: '300캐시' },
                { ic: '🛍️', t: '친구 쇼핑의 자동 적립', v: '10%', sub: '1년간 유지' },
                { ic: '🎁', t: '5명 초대마다 보너스', v: '500캐시' },
              ].map((b, i) => (
                <View key={i} style={styles.bRow}>
                  <View style={styles.bIcon}>
                    <Text style={styles.bIconEmoji}>{b.ic}</Text>
                  </View>
                  <Text style={styles.bText}>{b.t}</Text>
                  <View style={styles.bValueWrap}>
                    <Text style={styles.bValue}>{b.v}</Text>
                    {b.sub ? <Text style={styles.bSub}>{b.sub}</Text> : null}
                  </View>
                </View>
              ))}
            </View>

            {/* 초대 챌린지 */}
            <View style={styles.milestone}>
              <View style={styles.mHead}>
                <Text style={styles.mTitle}>초대 챌린지</Text>
                <Text style={styles.mCount}>{doneN}/5</Text>
              </View>
              <Text style={styles.mSub}>
                {n === 0 ? '친구 5명 초대에 도전해 보세요.' : `${GOAL - within || GOAL}명 더 초대하면 다음 단계 달성`}
              </Text>
              <View style={styles.steps}>
                {[1, 2, 3, 4, 5].map((s, i) => {
                  const done = i < doneN;
                  const goal = s === 5;
                  return (
                    <View key={s} style={styles.stepCell}>
                      {i > 0 && <View style={[styles.stepLine, i <= doneN && styles.stepLineOn]} />}
                      <View
                        style={[
                          styles.stepDot,
                          done && styles.stepDotDone,
                          goal && !done && styles.stepDotGoal,
                        ]}
                      >
                        {s === 5 && (
                          <View style={styles.stepBadge}>
                            <Text style={styles.stepBadgeText}>500캐시</Text>
                          </View>
                        )}
                        <Text
                          style={[
                            styles.stepNum,
                            done && styles.stepNumOn,
                            goal && !done && styles.stepNumGoal,
                          ]}
                        >
                          {s}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
              <Text style={styles.mGoal}>
                5명 달성 시 <Text style={styles.mGoalStrong}>500캐시</Text> 보너스 지급
              </Text>
            </View>

            {/* 추천인 코드 입력 */}
            {me && !me.referred && (
              <View style={styles.refcode}>
                <Text style={styles.refTitle}>추천인 코드가 있나요?</Text>
                <Text style={styles.refDesc}>
                  가입할 때 코드를 넣지 못했다면 아래에서 지금 등록하세요. 등록 후에는 변경할 수 없어요.
                </Text>
                <View style={styles.refRow}>
                  <TextInput
                    style={styles.refInput}
                    value={refInput}
                    onChangeText={setRefInput}
                    placeholder="추천인 코드 입력"
                    placeholderTextColor="#8b95a1"
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={16}
                  />
                  <Pressable style={styles.refBtn} onPress={onApply} disabled={applying}>
                    <Text style={styles.refBtnText}>{applying ? '...' : '등록'}</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </ScrollView>

          {/* 하단 고정 공유 버튼 */}
          <View style={styles.shareBar}>
            <Pressable style={styles.shareBtn} onPress={onShare}>
              <Text style={styles.shareBtnText}>친구에게 공유하기</Text>
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  topbar: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 30, color: '#191f28', lineHeight: 34 },
  topTitle: { fontSize: 16, fontWeight: '700', color: '#191f28' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  loginText: { fontSize: 14, color: '#8b95a1' },
  loginBtn: { height: 44, paddingHorizontal: 22, borderRadius: 10, backgroundColor: '#3182f6', alignItems: 'center', justifyContent: 'center' },
  loginBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 },

  hero: { alignItems: 'center', paddingBottom: 8 },
  heroImg: { width: 128, height: 112, marginBottom: 16 },
  badge: { backgroundColor: '#263041', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  badgeText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  badgeHi: { color: '#ffd43b', fontWeight: '800' },
  badgeTail: {
    width: 0, height: 0, marginBottom: 12,
    borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 7,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#263041',
  },
  heroTitle: { fontSize: 27, fontWeight: '800', color: '#191f28', textAlign: 'center', lineHeight: 35 },
  accent: { color: '#3182f6' },
  heroSub: { marginTop: 10, fontSize: 15, color: '#8b95a1', fontWeight: '500' },

  card: { marginTop: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e8eb', borderRadius: 18, padding: 20 },
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
  bRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 18, padding: 14, marginBottom: 12 },
  bIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f2f5fb', alignItems: 'center', justifyContent: 'center' },
  bIconEmoji: { fontSize: 22 },
  bText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#191f28' },
  bValueWrap: { alignItems: 'flex-end' },
  bValue: { fontSize: 20, fontWeight: '800', color: '#3182f6' },
  bSub: { fontSize: 12, color: '#8b95a1', marginTop: 3 },

  milestone: { marginTop: 28, marginBottom: 4 },
  mHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  mTitle: { fontSize: 16, fontWeight: '800', color: '#191f28' },
  mCount: { fontSize: 15, fontWeight: '800', color: '#3182f6' },
  mSub: { fontSize: 13.5, color: '#8b95a1', fontWeight: '500' },
  steps: { flexDirection: 'row', alignItems: 'center', marginTop: 44, marginBottom: 16, paddingHorizontal: 24 },
  stepCell: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  stepLine: { flex: 1, height: 3, backgroundColor: '#eceef1', marginHorizontal: 2, borderRadius: 2 },
  stepLineOn: { backgroundColor: '#3182f6' },
  stepDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#e5e8eb', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  stepDotDone: { backgroundColor: '#3182f6', borderColor: '#3182f6' },
  stepDotGoal: { borderColor: '#3182f6' },
  stepNum: { fontSize: 15, fontWeight: '700', color: '#b0b8c1' },
  stepNumOn: { color: '#fff' },
  stepNumGoal: { color: '#3182f6' },
  stepBadge: { position: 'absolute', bottom: 44, backgroundColor: '#2b3441', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  stepBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  mGoal: { textAlign: 'center', fontSize: 13.5, color: '#8b95a1', fontWeight: '500' },
  mGoalStrong: { color: '#4e5968', fontWeight: '800' },

  refcode: { marginTop: 20, marginHorizontal: -16, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 26, backgroundColor: '#eff4ff' },
  refTitle: { fontSize: 18, fontWeight: '800', color: '#191f28', marginBottom: 8 },
  refDesc: { fontSize: 13.5, lineHeight: 21, color: '#8b95a1', marginBottom: 16 },
  refRow: { flexDirection: 'row', gap: 8 },
  refInput: { flex: 1, height: 50, borderWidth: 1, borderColor: '#d6e0f0', borderRadius: 12, paddingHorizontal: 16, fontSize: 15, color: '#191f28', backgroundColor: '#fff' },
  refBtn: { minWidth: 76, height: 50, borderRadius: 12, backgroundColor: '#3182f6', alignItems: 'center', justifyContent: 'center' },
  refBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  shareBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, backgroundColor: '#fff' },
  shareBtn: { height: 54, borderRadius: 999, backgroundColor: '#3182f6', alignItems: 'center', justifyContent: 'center', shadowColor: '#3182f6', shadowOpacity: 0.36, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  shareBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
});
