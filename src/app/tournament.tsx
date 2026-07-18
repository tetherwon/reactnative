import { Image } from 'expo-image';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import WebBottomNav from '@/components/WebBottomNav';
import { ApiError, apiFetch, apiFetchSWR, BASE_URL } from '@/lib/api';
import { requestWebNav } from '@/lib/webNav';
import * as haptics from '@/lib/haptics';

// 웹 /tournament(tournament.html + tournament-inline-2.js)의 네이티브 로비.
// 북극곰 가위바위보 = 모든 참가자가 동시에 랜덤 곰 손과 대결하는 서바이벌.
// 관리자 전용 베타 — 비관리자는 '준비중' 카드(웹과 동일).

type Tournament = {
  id: number;
  date: string;
  scheduled_hour: number;
  scheduled_minute: number;
  status: string; // registering | active | finished | cancelled
  current_round: number;
  winner_user_id: number | null;
  prize_desc: string;
  participant_count: number;
  survivor_count: number;
  user_status: string | null; // active | eliminated | winner | null
};

const srv = (p: string) => encodeURI(BASE_URL + p);
const pad = (n: number) => String(n).padStart(2, '0');

function todayKST(): string {
  // KST(UTC+9) 기준 오늘 날짜 YYYY-MM-DD
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
  return `${kst.getFullYear()}-${pad(kst.getMonth() + 1)}-${pad(kst.getDate())}`;
}

function startTs(t: Tournament): number {
  // 해당 슬롯 시작 시각(unix, KST 슬롯). date+hour+minute 를 KST로 해석.
  const [y, m, d] = t.date.split('-').map(Number);
  // KST 자정 = UTC-9h. Date.UTC 로 만들고 9시간 빼서 슬롯 시각 산출.
  const utcMidnightKst = Date.UTC(y, m - 1, d, 0, 0, 0) - 9 * 3600 * 1000;
  return Math.floor((utcMidnightKst + (t.scheduled_hour * 3600 + t.scheduled_minute * 60) * 1000) / 1000);
}

function fmtCountdown(sec: number): string {
  if (sec <= 0) return '진행 중';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}시간 ${pad(m)}분 ${pad(s)}초`;
  if (m > 0) return `${m}분 ${pad(s)}초`;
  return `${s}초`;
}

export default function TournamentScreen() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tickets, setTickets] = useState(0);
  const [loggedIn, setLoggedIn] = useState<boolean>(true);
  const [tours, setTours] = useState<Tournament[] | null>(null);
  const [joining, setJoining] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2600);
  };

  const load = useCallback((alive: () => boolean) => {
    apiFetch<{ user?: { is_admin?: boolean; ticket_count?: number } }>('/api/auth/me')
      .then((d) => {
        if (!alive()) return;
        setLoggedIn(true);
        setIsAdmin(!!d.user?.is_admin);
        setTickets(Number(d.user?.ticket_count || 0));
      })
      .catch((e) => {
        if (!alive()) return;
        if (e instanceof ApiError && e.status === 401) {
          setLoggedIn(false);
          setIsAdmin(false);
        }
      });
    apiFetchSWR<{ tournaments?: Tournament[] }>('/api/tournament/list', (d) => {
      if (alive()) setTours(d.tournaments || []);
    }).catch(() => {
      if (alive()) setTours([]);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      const alive = () => mounted;
      load(alive);
      // 일정/카운트다운 갱신
      tick.current = setInterval(() => {
        if (!mounted) return;
        setNow(Math.floor(Date.now() / 1000));
      }, 1000);
      const poll = setInterval(() => load(alive), 30000);
      return () => {
        mounted = false;
        if (tick.current) clearInterval(tick.current);
        clearInterval(poll);
      };
    }, [load]),
  );

  const onJoin = (t: Tournament) => {
    if (!loggedIn) {
      requestWebNav('/login');
      router.dismissTo('/');
      return;
    }
    if (joining) return;
    haptics.tap();
    setJoining(t.id);
    apiFetch<{ ok?: boolean; ticket_count?: number }>(`/api/tournament/join?id=${t.id}`, { method: 'POST' })
      .then((d) => {
        haptics.success();
        setTickets(Number(d.ticket_count ?? tickets));
        showToast('신청 완료! 시작 시간에 입장하세요.');
        let live = true;
        load(() => live);
        setTimeout(() => (live = false), 8000);
      })
      .catch((e) => {
        haptics.error();
        showToast(e instanceof ApiError && e.message ? e.message : '앗, 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
      })
      .finally(() => setJoining(null));
  };

  const enter = (t: Tournament) => {
    haptics.tap();
    router.push((`/tournament-play?tid=${t.id}`) as Href);
  };

  // 오늘 이전(미래 슬롯 제외) — 웹과 동일
  const today = todayKST();
  const shown = (tours || []).filter((t) => t.date <= today);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>가위바위보</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {isAdmin === false ? (
          // 준비중 (비관리자)
          <View style={styles.comingWrap}>
            <Image source={srv('/static/images/gom/gom-rps.webp')} style={styles.comingImg} contentFit="contain" />
            <Text style={styles.comingTitle}>준비중입니다</Text>
            <Text style={styles.comingDesc}>
              북극곰 가위바위보 토너먼트를 더 재미있게 준비하고 있어요.{'\n'}조금만 기다려 주세요!
            </Text>
            <Pressable
              style={styles.comingBtn}
              onPress={() => {
                requestWebNav('/benefit');
                router.dismissTo('/');
              }}
            >
              <Text style={styles.comingBtnText}>혜택 보러가기</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* 히어로 */}
            <View style={styles.hero}>
              <View style={styles.heroTextWrap}>
                <Text style={styles.heroEyebrow}>매일 오후 6시 ~ 10시</Text>
                <Text style={styles.heroTitle}>북극곰 가위바위보{'\n'}토너먼트</Text>
                {tickets === 0 && (
                  <Pressable
                    style={styles.chargeCta}
                    onPress={() => {
                      requestWebNav('/tickets');
                      router.dismissTo('/');
                    }}
                  >
                    <Text style={styles.chargeCtaText}>티켓 충전하고 참가하기</Text>
                  </Pressable>
                )}
              </View>
              <Image source={srv('/static/images/gom/gom-rps.webp')} style={styles.heroBear} contentFit="contain" />
            </View>

            <Text style={styles.sectionTitle}>대전 일정</Text>
            {tours === null ? (
              <Text style={styles.loading}>불러오는 중...</Text>
            ) : shown.length === 0 ? (
              <Text style={styles.empty}>예정된 대전이 없어요. 곧 새 일정이 올라와요!</Text>
            ) : (
              shown.map((t) => {
                const started = now >= startTs(t);
                const countdown = t.status === 'finished' || t.status === 'cancelled'
                  ? '완료'
                  : fmtCountdown(startTs(t) - now);
                const isToday = t.date === today;
                const past = t.status === 'finished' || t.status === 'cancelled';
                const joined = !!t.user_status;
                return (
                  <View key={t.id} style={[styles.card, started && !past && styles.cardLive]}>
                    <View style={styles.cardTop}>
                      <Text style={styles.cardTime}>
                        {isToday ? '오늘' : t.date.slice(5).replace('-', '.')} {pad(t.scheduled_hour)}:
                        {pad(t.scheduled_minute)}
                      </Text>
                      {t.status === 'active' ? (
                        <View style={[styles.chip, styles.chipLive]}>
                          <Text style={styles.chipLiveText}>진행 중</Text>
                        </View>
                      ) : past ? (
                        <View style={styles.chip}>
                          <Text style={styles.chipText}>종료</Text>
                        </View>
                      ) : (
                        <Text style={styles.countdown}>{countdown}</Text>
                      )}
                    </View>
                    <Text style={styles.cardPrize}>
                      🎁 {t.prize_desc || '메가커피 아메리카노'} · {t.participant_count}명 참가중
                    </Text>

                    <View style={styles.cardActions}>
                      {joined && (t.status === 'active' || t.status === 'registering') ? (
                        <Pressable style={styles.btnPrimary} onPress={() => enter(t)}>
                          <Text style={styles.btnPrimaryText}>입장하기 ›</Text>
                        </Pressable>
                      ) : t.status === 'registering' ? (
                        <Pressable
                          style={[styles.btnPrimary, joining === t.id && styles.btnDisabled]}
                          onPress={() => onJoin(t)}
                          disabled={joining === t.id}
                        >
                          <Text style={styles.btnPrimaryText}>
                            {joining === t.id ? '처리 중...' : loggedIn ? '티켓 1장으로 참가' : '로그인하고 참여하기'}
                          </Text>
                        </Pressable>
                      ) : t.status === 'active' ? (
                        <View style={[styles.btnPrimary, styles.btnDisabled]}>
                          <Text style={styles.btnDisabledText}>진행 중</Text>
                        </View>
                      ) : (
                        <View style={[styles.btnGhost]}>
                          <Text style={styles.btnGhostText}>
                            {t.winner_user_id ? '🏆 우승자 결정' : '종료된 대전'}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}

            {/* 게임 방법 */}
            <View style={styles.howto}>
              <Text style={styles.howtoTitle}>게임 방법</Text>
              {[
                ['티켓으로 참가 신청', '매일 오후 6시~10시, 티켓 1장으로 토너먼트에 입장해요.'],
                ['북극곰과 가위바위보', '제한 시간 안에 가위·바위·보 중 하나를 선택하면, 곰의 손이 공개돼요.'],
                ['이기면 다음 라운드 진출', '비기면 재대결, 지면 탈락! 한 라운드씩 올라가며 경쟁해요.'],
                ['끝까지 살아남으면 보상', '최종 라운드까지 승리한 참가자에게 티켓 등 보상이 지급돼요.'],
              ].map(([t, d], i) => (
                <View key={i} style={styles.howtoRow}>
                  <View style={styles.howtoNum}>
                    <Text style={styles.howtoNumText}>{i + 1}</Text>
                  </View>
                  <View style={styles.howtoBody}>
                    <Text style={styles.howtoStepTitle}>{t}</Text>
                    <Text style={styles.howtoStepDesc}>{d}</Text>
                  </View>
                </View>
              ))}
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
  loading: { textAlign: 'center', color: '#8b95a1', paddingVertical: 30, fontSize: 14 },
  empty: { textAlign: 'center', color: '#8b95a1', paddingVertical: 30, fontSize: 14 },
  // 준비중
  comingWrap: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 20 },
  comingImg: { width: 160, height: 160, marginBottom: 20 },
  comingTitle: { fontSize: 20, fontWeight: '800', color: '#191f28', marginBottom: 10 },
  comingDesc: { fontSize: 14, color: '#8b95a1', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  comingBtn: { backgroundColor: '#3182f6', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 28 },
  comingBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  // 히어로
  hero: {
    flexDirection: 'row',
    backgroundColor: '#3182f6',
    borderRadius: 18,
    padding: 20,
    marginTop: 8,
    marginBottom: 22,
    overflow: 'hidden',
    minHeight: 150,
  },
  heroTextWrap: { flex: 1, zIndex: 2 },
  heroEyebrow: { fontSize: 11, fontWeight: '700', color: '#fde047', letterSpacing: 0.5 },
  heroTitle: { fontSize: 24, fontWeight: '900', color: '#ffffff', lineHeight: 30, marginTop: 6 },
  chargeCta: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
    marginTop: 14,
  },
  chargeCtaText: { color: '#2272eb', fontSize: 13, fontWeight: '800' },
  heroBear: { position: 'absolute', right: -8, bottom: -18, width: 150, height: 150 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#191f28', marginBottom: 12 },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e8eb',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  cardLive: { borderColor: '#3182f6', borderWidth: 1.5 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardTime: { fontSize: 15, fontWeight: '800', color: '#191f28' },
  chip: { backgroundColor: '#f2f4f6', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, fontWeight: '700', color: '#8b95a1' },
  chipLive: { backgroundColor: '#fdecee' },
  chipLiveText: { fontSize: 12, fontWeight: '800', color: '#e42939' },
  countdown: { fontSize: 13, fontWeight: '800', color: '#3182f6' },
  cardPrize: { fontSize: 13, color: '#4e5968', marginBottom: 14 },
  cardActions: { flexDirection: 'row', gap: 8 },
  btnPrimary: { flex: 1, backgroundColor: '#3182f6', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnPrimaryText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  btnDisabled: { backgroundColor: '#e5e8eb' },
  btnDisabledText: { color: '#8b95a1', fontSize: 14, fontWeight: '800' },
  btnGhost: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnGhostText: { color: '#8b95a1', fontSize: 14, fontWeight: '700' },
  // 게임 방법
  howto: { marginTop: 20, backgroundColor: '#f8fafc', borderRadius: 14, padding: 18 },
  howtoTitle: { fontSize: 15, fontWeight: '800', color: '#191f28', marginBottom: 14 },
  howtoRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  howtoNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#3182f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  howtoNumText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  howtoBody: { flex: 1 },
  howtoStepTitle: { fontSize: 14, fontWeight: '800', color: '#191f28', marginBottom: 2 },
  howtoStepDesc: { fontSize: 12.5, color: '#8b95a1', lineHeight: 18 },
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
});
