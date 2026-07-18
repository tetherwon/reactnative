import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import WebBottomNav from '@/components/WebBottomNav';
import { ApiError, apiFetch, apiFetchSWR } from '@/lib/api';
import * as haptics from '@/lib/haptics';

// 웹 profile.html의 문의하기/내 문의 내역 모달을 네이티브 화면으로 옮긴 것.
// 서버 엔드포인트 동일: POST /api/inquiry (form) · GET /api/inquiry/me.
// 이미지 첨부는 expo-image-picker 미도입이라 이번 버전엔 없음(서버상 선택 항목).

type Inquiry = {
  id: number;
  subject: string;
  body: string;
  status: string;
  admin_reply?: string | null;
  created_at: number;
  replied_at?: number | null;
};

function fmtDate(ts: number): string {
  const d = new Date((ts || 0) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

export default function InquiriesScreen() {
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [items, setItems] = useState<Inquiry[] | null>(null);

  const loadHistory = useCallback((alive: () => boolean) => {
    apiFetchSWR<{ items?: Inquiry[] }>('/api/inquiry/me', (d) => {
      if (alive()) setItems(d.items || []);
    }).catch((e) => {
      if (alive() && e instanceof ApiError && e.status === 401) router.back();
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      const alive = () => mounted;
      // 답변 받을 이메일 자동 채움 (수정 가능)
      apiFetch<{ user?: { email?: string } }>('/api/me')
        .then((d) => {
          if (alive() && d.user?.email) setEmail((cur) => cur || String(d.user!.email));
        })
        .catch(() => {});
      loadHistory(alive);
      return () => {
        mounted = false;
      };
    }, [loadHistory]),
  );

  const submit = () => {
    if (submitting) return;
    if (!email.trim() || !subject.trim() || !body.trim()) {
      setMsg({ text: '모든 항목을 입력해 주세요.', ok: false });
      return;
    }
    haptics.tap();
    setSubmitting(true);
    setMsg(null);
    const form = new URLSearchParams({
      email: email.trim(),
      subject: subject.trim(),
      body: body.trim(),
    }).toString();
    apiFetch<{ ok?: boolean }>('/api/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    })
      .then(() => {
        haptics.success();
        setMsg({ text: '문의를 접수했어요. 빠르게 답변 드릴게요!', ok: true });
        setSubject('');
        setBody('');
        // 방금 넣은 문의가 내역에 보이도록 갱신
        let live = true;
        loadHistory(() => live);
        setTimeout(() => {
          live = false;
        }, 8000);
      })
      .catch((e) => {
        haptics.error();
        const detail =
          e instanceof ApiError && e.message ? e.message : '앗, 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
        setMsg({ text: detail, ok: false });
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>문의하기</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* 문의 작성 폼 */}
          <View style={styles.card}>
            <Text style={styles.label}>
              이메일 <Text style={styles.req}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="답변 받을 이메일"
              placeholderTextColor="#b0b8c1"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.label}>
              제목 <Text style={styles.req}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={subject}
              onChangeText={setSubject}
              placeholder="문의 제목을 입력하세요"
              placeholderTextColor="#b0b8c1"
              maxLength={100}
            />

            <Text style={styles.label}>
              내용 <Text style={styles.req}>*</Text>
            </Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={body}
              onChangeText={setBody}
              placeholder="문의 내용을 상세히 입력해 주세요."
              placeholderTextColor="#b0b8c1"
              multiline
              maxLength={2000}
              textAlignVertical="top"
            />

            <Pressable
              style={[styles.submit, submitting && styles.submitDisabled]}
              onPress={submit}
              disabled={submitting}
            >
              <Text style={styles.submitText}>{submitting ? '제출 중...' : '문의 제출'}</Text>
            </Pressable>
            {!!msg && (
              <Text style={[styles.msg, msg.ok ? styles.msgOk : styles.msgErr]}>{msg.text}</Text>
            )}
          </View>

          {/* 내 문의 내역 */}
          <Text style={styles.sectionTitle}>내 문의 내역</Text>
          {items === null ? (
            <Text style={styles.loading}>불러오는 중...</Text>
          ) : items.length === 0 ? (
            <Text style={styles.empty}>아직 문의 내역이 없어요.</Text>
          ) : (
            items.map((it) => {
              const answered = it.status === 'answered';
              return (
                <View key={it.id} style={styles.histItem}>
                  <View style={styles.histTop}>
                    <View style={[styles.pill, answered ? styles.pillDone : styles.pillWait]}>
                      <Text style={[styles.pillText, answered ? styles.pillTextDone : styles.pillTextWait]}>
                        {answered ? '답변 완료' : '대기 중'}
                      </Text>
                    </View>
                    <Text style={styles.histDate}>{fmtDate(it.created_at)}</Text>
                  </View>
                  <Text style={styles.histSubject}>{it.subject}</Text>
                  <Text style={styles.histBody}>{it.body}</Text>
                  {!!it.admin_reply && (
                    <View style={styles.replyBox}>
                      <Text style={styles.replyText}>
                        <Text style={styles.replyLabel}>답변: </Text>
                        {it.admin_reply}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <WebBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  flex: { flex: 1 },
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
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eef0f4',
    padding: 16,
    marginBottom: 24,
  },
  label: { fontSize: 13, fontWeight: '700', color: '#333d4b', marginBottom: 6, marginTop: 12 },
  req: { color: '#f04452' },
  input: {
    borderWidth: 1,
    borderColor: '#e5e8eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: '#191f28',
    backgroundColor: '#fbfcfd',
  },
  textarea: { minHeight: 120 },
  submit: {
    marginTop: 18,
    backgroundColor: '#3182f6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitDisabled: { backgroundColor: '#a9c7f8' },
  submitText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  msg: { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 12 },
  msgOk: { color: '#22c55e' },
  msgErr: { color: '#ef4444' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#191f28', marginBottom: 12 },
  loading: { textAlign: 'center', color: '#8b95a1', paddingVertical: 30, fontSize: 14 },
  empty: { textAlign: 'center', color: '#8b95a1', paddingVertical: 30, fontSize: 14 },
  histItem: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eef0f4',
    padding: 14,
    marginBottom: 10,
  },
  histTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillDone: { backgroundColor: '#dcfce7' },
  pillWait: { backgroundColor: '#fef3c7' },
  pillText: { fontSize: 11.5, fontWeight: '800' },
  pillTextDone: { color: '#16a34a' },
  pillTextWait: { color: '#b45309' },
  histDate: { fontSize: 12, color: '#a2aab5', fontWeight: '600' },
  histSubject: { fontSize: 14, fontWeight: '700', color: '#191f28', marginBottom: 4 },
  histBody: { fontSize: 13, color: '#8b95a1', lineHeight: 19 },
  replyBox: { backgroundColor: '#f0f4fb', borderRadius: 10, padding: 11, marginTop: 10 },
  replyText: { fontSize: 13, color: '#334155', lineHeight: 19 },
  replyLabel: { fontWeight: '800', color: '#2563eb' },
});
