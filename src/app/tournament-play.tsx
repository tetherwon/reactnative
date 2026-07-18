import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, apiFetch, BASE_URL } from '@/lib/api';
import * as haptics from '@/lib/haptics';

// 웹 tournament-play.html 의 네이티브 구현. /api/tournament/today 폴링 → 라운드 진행.
// 곰(system)이 낸 랜덤 손을 이기면 진출, 비기면 재대결, 지면 탈락.

type Choice = 'rock' | 'scissors' | 'paper';
const LABEL: Record<Choice, string> = { rock: '바위', scissors: '가위', paper: '보' };
const EMOJI: Record<Choice, string> = { rock: '✊', scissors: '✌️', paper: '🖐️' };
// key가 이기는 대상 (rock beats scissors ...)
const BEATS: Record<Choice, Choice> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const ORDER: Choice[] = ['scissors', 'rock', 'paper']; // 가위 · 바위 · 보

type Round = {
  round: number;
  deadline: number;
  system_choice: Choice | null;
  revealed: boolean;
  choice_counts: Record<string, number>;
};
type Today = {
  tournament: { id: number; status: string; scheduled_hour: number; scheduled_minute: number; current_round: number };
  participant_count: number;
  survivor_count: number;
  user_status: string | null;
  my_choice: Choice | null;
  current_round: Round | null;
};

const srv = (p: string) => encodeURI(BASE_URL + p);
const pad = (n: number) => String(n).padStart(2, '0');

function outcomeOf(mine: Choice | null, sys: Choice | null): 'win' | 'draw' | 'lose' | 'none' {
  if (!mine) return 'none';
  if (!sys) return 'none';
  if (mine === sys) return 'draw';
  return BEATS[mine] === sys ? 'win' : 'lose';
}

export default function TournamentPlayScreen() {
  const params = useLocalSearchParams<{ tid?: string }>();
  const tid = Number(params.tid || 0);

  const [data, setData] = useState<Today | null>(null);
  const [phase, setPhase] = useState<'loading' | 'notJoined' | 'waiting' | 'match' | 'final'>('loading');
  const [pending, setPending] = useState<Choice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  const loadRef = useRef<() => void>(() => {});

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2600);
  };

  const scheduleNext = (ms: number, fn: () => void) => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(() => {
      if (aliveRef.current) fn();
    }, ms);
  };

  const load = useCallback(() => {
    apiFetch<Today>(`/api/tournament/today?id=${tid}`)
      .then((d) => {
        if (!aliveRef.current) return;
        setData(d);
        const st = d.tournament?.status;
        if (!d.user_status) {
          setPhase('notJoined');
          return;
        }
        if (st === 'finished' || st === 'cancelled' || d.user_status === 'eliminated' || d.user_status === 'winner') {
          // 결과가 공개된 라운드가 있으면 잠깐 보여주고 최종 화면
          if (d.current_round && d.current_round.revealed) {
            setPhase('match');
            scheduleNext(6000, () => setPhase('final'));
          } else {
            setPhase('final');
          }
          return;
        }
        if (d.current_round) {
          setPhase('match');
          scheduleNext(2000, () => loadRef.current());
        } else if (st === 'registering') {
          setPhase('waiting');
          scheduleNext(5000, () => loadRef.current());
        } else {
          scheduleNext(3000, () => loadRef.current());
        }
      })
      .catch((e) => {
        if (!aliveRef.current) return;
        if (e instanceof ApiError && e.status === 401) {
          router.back();
          return;
        }
        scheduleNext(5000, () => loadRef.current());
      });
  }, [tid]);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      aliveRef.current = true;
      setPhase('loading');
      load();
      const t = setInterval(() => aliveRef.current && setNow(Math.floor(Date.now() / 1000)), 1000);
      return () => {
        aliveRef.current = false;
        if (pollRef.current) clearTimeout(pollRef.current);
        clearInterval(t);
      };
    }, [load]),
  );

  const submit = () => {
    if (!pending || submitting || !data) return;
    haptics.tap();
    setSubmitting(true);
    apiFetch<{ ok?: boolean }>('/api/tournament/submit', {
      method: 'POST',
      body: JSON.stringify({ tournament_id: tid, choice: pending }),
    })
      .then(() => {
        haptics.success();
        setData((d) => (d ? { ...d, my_choice: pending } : d));
        setPending(null);
        scheduleNext(1500, () => loadRef.current());
      })
      .catch((e) => {
        haptics.error();
        showToast(e instanceof ApiError && e.message ? e.message : '네트워크 오류가 발생했습니다. 다시 시도해 주세요.');
      })
      .finally(() => setSubmitting(false));
  };

  const round = data?.current_round || null;
  const revealed = !!round?.revealed && !!round?.system_choice;
  const mine = data?.my_choice || null;
  const outcome = outcomeOf(mine, round?.system_choice || null);
  const deadlineLeft = round ? Math.max(0, round.deadline - now) : 0;
  const label = data
    ? `${pad(data.tournament.scheduled_hour)}:${pad(data.tournament.scheduled_minute)} 토너먼트`
    : '';

  const back = () => router.back();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={back} hitSlop={10}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>가위바위보</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.body}>
        {phase === 'loading' && (
          <View style={styles.center}>
            <Image source={srv('/static/images/gom/gom-nav.webp')} style={styles.loadBear} contentFit="contain" />
            <Text style={styles.loadText}>불러오는 중...</Text>
          </View>
        )}

        {phase === 'notJoined' && (
          <View style={styles.center}>
            <Text style={styles.bigText}>참가 신청 후 입장할 수 있어요.</Text>
            <Pressable style={styles.primaryBtn} onPress={back}>
              <Text style={styles.primaryBtnText}>토너먼트로 돌아가기</Text>
            </Pressable>
          </View>
        )}

        {phase === 'waiting' && (
          <View style={styles.center}>
            <Image source={srv('/static/images/gom/bear-cushion.webp')} style={styles.waitBear} contentFit="contain" />
            <Text style={styles.waitLabel}>{label}</Text>
            <Text style={styles.bigText}>게임 준비 중입니다</Text>
            <Text style={styles.waitCount}>{data?.participant_count ?? 0}명 입장 중</Text>
          </View>
        )}

        {phase === 'match' && round && (
          <View style={styles.matchWrap}>
            <Text style={styles.matchLabel}>{label}</Text>
            <View style={styles.roundBadge}>
              <Text style={styles.roundBadgeText}>라운드 {round.round}</Text>
            </View>

            {/* 곰 */}
            <View style={[styles.bearCircle, revealed && styles.bearCircleRevealed]}>
              {revealed ? (
                <Text style={styles.bearEmoji}>{EMOJI[round.system_choice as Choice]}</Text>
              ) : (
                <Image source={srv('/static/logos/shoppinglog.webp')} style={styles.bearImg} contentFit="contain" />
              )}
            </View>
            <Text style={styles.bearLabel}>
              {revealed ? `곰의 선택: ${LABEL[round.system_choice as Choice]}` : '곰이 손을 숨기고 있어요'}
            </Text>

            {/* 공개 후 결과 */}
            {revealed ? (
              <View style={styles.outcomeBox}>
                <Text
                  style={[
                    styles.outcomeText,
                    outcome === 'win' && styles.outWin,
                    outcome === 'lose' && styles.outLose,
                    outcome === 'draw' && styles.outDraw,
                  ]}
                >
                  {outcome === 'win'
                    ? '곰을 이겼어요!'
                    : outcome === 'draw'
                      ? '🤝 곰과 비겼어요'
                      : outcome === 'lose'
                        ? '😢 곰에게 졌어요'
                        : '⏰ 미제출이에요'}
                </Text>
                <Text style={styles.outcomeSub}>
                  {mine
                    ? `나 ${EMOJI[mine]} ${LABEL[mine]}  vs  곰 ${EMOJI[round.system_choice as Choice]} ${LABEL[round.system_choice as Choice]}`
                    : '시간 내에 선택을 제출하지 못했어요'}
                </Text>
                <Text style={styles.nextHint}>
                  {outcome === 'draw' ? '🔄 비겼어요! 다음 라운드로 이어집니다' : '결과 정리 중 · 다음 라운드 준비 중...'}
                </Text>
              </View>
            ) : mine ? (
              // 제출 완료, 공개 대기
              <View style={styles.outcomeBox}>
                <Text style={styles.submittedText}>✅ 제출 완료!</Text>
                <Text style={styles.outcomeSub}>
                  내 선택: {EMOJI[mine]} {LABEL[mine]}
                </Text>
                <Text style={styles.nextHint}>곰의 선택을 기다리는 중...</Text>
              </View>
            ) : (
              // 선택 UI
              <>
                <Text style={styles.deadline}>제출 마감 {pad(Math.floor(deadlineLeft / 60))}:{pad(deadlineLeft % 60)}</Text>
                <View style={styles.rpsRow}>
                  {ORDER.map((c) => {
                    const on = pending === c;
                    const cnt = Number(round.choice_counts?.[c] || 0);
                    return (
                      <Pressable
                        key={c}
                        style={[styles.rpsBtn, on && styles.rpsBtnOn]}
                        onPress={() => {
                          haptics.tap();
                          setPending(c);
                        }}
                      >
                        <Text style={styles.rpsEmoji}>{EMOJI[c]}</Text>
                        <Text style={[styles.rpsLabel, on && styles.rpsLabelOn]}>{LABEL[c]}</Text>
                        <Text style={styles.rpsCount}>{cnt}명</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  style={[styles.submitBtn, (!pending || submitting) && styles.submitBtnDisabled]}
                  onPress={submit}
                  disabled={!pending || submitting}
                >
                  <Text style={styles.submitBtnText}>
                    {submitting
                      ? '제출 중...'
                      : pending
                        ? `${EMOJI[pending]} ${LABEL[pending]} 선택 · 제출하기`
                        : '선택하고 제출하기'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {phase === 'final' && (
          <View style={styles.center}>
            {data?.user_status === 'winner' ? (
              <>
                <Image source={srv('/static/giftshoplogo/npay30000.webp')} style={styles.prizeImg} contentFit="contain" />
                <Text style={styles.finalTitle}>🏆 우승을 축하합니다!</Text>
                <Text style={styles.finalDesc}>보상은 24시간 내로 쿠폰함에 지급됩니다.</Text>
              </>
            ) : (
              <>
                <Image source={srv('/static/images/gom/gom-nav.webp')} style={styles.waitBear} contentFit="contain" />
                <Text style={styles.finalTitle}>
                  {data?.user_status === 'eliminated' ? '이번 라운드에서 탈락했습니다.' : '토너먼트가 종료되었습니다.'}
                </Text>
                <Text style={styles.finalDesc}>다음 대전에 다시 도전해 보세요!</Text>
              </>
            )}
            <Pressable style={styles.primaryBtn} onPress={back}>
              <Text style={styles.primaryBtnText}>토너먼트로 돌아가기</Text>
            </Pressable>
          </View>
        )}
      </View>

      {!!toast && (
        <View style={styles.toastWrap} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
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
  body: { flex: 1, paddingHorizontal: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 60 },
  loadBear: { width: 80, height: 80 },
  loadText: { fontSize: 14, color: '#8b95a1' },
  bigText: { fontSize: 17, fontWeight: '800', color: '#191f28', textAlign: 'center' },
  waitBear: { width: 140, height: 140 },
  waitLabel: { fontSize: 13, fontWeight: '700', color: '#3182f6' },
  waitCount: { fontSize: 14, color: '#8b95a1', fontWeight: '600' },
  matchWrap: { flex: 1, alignItems: 'center', paddingTop: 12 },
  matchLabel: { fontSize: 13, fontWeight: '700', color: '#8b95a1' },
  roundBadge: { backgroundColor: '#eff4ff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 8 },
  roundBadgeText: { fontSize: 13, fontWeight: '800', color: '#2272eb' },
  bearCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#f2f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  bearCircleRevealed: { backgroundColor: '#eff4ff' },
  bearImg: { width: 110, height: 110 },
  bearEmoji: { fontSize: 76 },
  bearLabel: { fontSize: 14, fontWeight: '700', color: '#4e5968', marginTop: 12 },
  outcomeBox: { alignItems: 'center', marginTop: 24, gap: 8 },
  outcomeText: { fontSize: 22, fontWeight: '900', color: '#191f28' },
  outWin: { color: '#00a661' },
  outLose: { color: '#e42939' },
  outDraw: { color: '#f59e0b' },
  outcomeSub: { fontSize: 14, color: '#4e5968', fontWeight: '600' },
  nextHint: { fontSize: 13, color: '#8b95a1', marginTop: 4 },
  submittedText: { fontSize: 20, fontWeight: '900', color: '#00a661' },
  deadline: { fontSize: 14, fontWeight: '800', color: '#e42939', marginTop: 24 },
  rpsRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  rpsBtn: {
    width: 92,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#e5e8eb',
    backgroundColor: '#fff',
    alignItems: 'center',
    gap: 4,
  },
  rpsBtnOn: { borderColor: '#3182f6', backgroundColor: '#eff4ff' },
  rpsEmoji: { fontSize: 40 },
  rpsLabel: { fontSize: 14, fontWeight: '800', color: '#4e5968' },
  rpsLabelOn: { color: '#2272eb' },
  rpsCount: { fontSize: 11.5, color: '#8b95a1', fontWeight: '600' },
  submitBtn: {
    marginTop: 26,
    width: '100%',
    backgroundColor: '#3182f6',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitBtnDisabled: { backgroundColor: '#c9d6ea' },
  submitBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  prizeImg: { width: 160, height: 110 },
  finalTitle: { fontSize: 19, fontWeight: '900', color: '#191f28', textAlign: 'center', lineHeight: 26 },
  finalDesc: { fontSize: 14, color: '#8b95a1', textAlign: 'center', lineHeight: 21 },
  primaryBtn: { marginTop: 16, backgroundColor: '#3182f6', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 28 },
  primaryBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  toastWrap: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
    backgroundColor: 'rgba(25,31,40,0.94)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  toastText: { color: '#ffffff', fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 19 },
});
