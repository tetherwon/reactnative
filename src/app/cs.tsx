import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import WebBottomNav from '@/components/WebBottomNav';
import * as haptics from '@/lib/haptics';

// 웹 /cs(templates/cs.html)의 네이티브 구현 — FAQ 아코디언 + 제휴 메일 + 카톡 채널.
// 정적 콘텐츠라 웹 페이지와 문구를 동일하게 유지한다 (수정 시 양쪽 함께).

const FAQS: { q: string; a: string }[] = [
  {
    q: '캐시백은 언제 적립되나요?',
    a: '구매 확정(배송 완료·반품 없음) 후, 구매한 달의 다다음 달 6~10일경 자동 적립됩니다. 쇼핑몰마다 구매 확정 기간이 다를 수 있어요.',
  },
  {
    q: '쇼핑로그 링크를 통해 구매했는데 내역이 없어요.',
    a: '쇼핑로그 링크 클릭 후 같은 브라우저에서 구매를 완료했는지 확인해주세요. 다른 탭 이동·앱 전환·쿠폰 코드 직접 입력 시 추적이 끊길 수 있습니다.',
  },
  {
    q: '캐시는 어디서 사용하나요?',
    a: '캐시상점(/store)에서 네이버페이 포인트, 스타벅스·메가커피 모바일 교환권, 올리브영 상품권 등으로 교환할 수 있습니다.',
  },
  {
    q: '티켓은 어떻게 얻나요?',
    a: '매일 출석 체크, 친구 초대, 상점 구매를 통해 티켓을 얻을 수 있습니다. 초대한 친구가 가입 완료 시 즉시 지급됩니다.',
  },
  {
    q: '등급(실버·골드)은 어떻게 올리나요?',
    a: '쇼핑로그 제휴 링크로 구매해 확정된 금액이 최근 30일 기준 50만 원 이상이면 실버, 200만 원 이상이면 골드 등급이 됩니다. 등급은 매일 최근 30일 실적 기준으로 갱신됩니다.',
  },
];

const KAKAO_CHANNEL_URL = 'https://pf.kakao.com/_ybbGX';
const PARTNER_EMAIL = 'hello.shoppinglog@gmail.com';

export default function CsScreen() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const toggle = (i: number) => {
    haptics.tap();
    setOpenIdx((cur) => (cur === i ? null : i));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>고객센터</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* FAQ */}
        <Text style={styles.sectionLabel}>자주 묻는 질문</Text>
        <View style={styles.faqList}>
          {FAQS.map((f, i) => (
            <View key={i} style={styles.faqItem}>
              <Pressable style={styles.faqQ} onPress={() => toggle(i)}>
                <Text style={styles.faqQText}>{f.q}</Text>
                <Text style={[styles.faqChevron, openIdx === i && styles.faqChevronOpen]}>›</Text>
              </Pressable>
              {openIdx === i && <Text style={styles.faqA}>{f.a}</Text>}
            </View>
          ))}
        </View>

        {/* 파트너·제휴 문의 */}
        <View style={styles.partnerCard}>
          <Text style={styles.partnerEyebrow}>문의 + 파트너 유입</Text>
          <Text style={styles.partnerTitle}>제휴, 광고, 파트너 문의를 기다립니다</Text>
          <Text style={styles.partnerSub}>입점·광고·파트너십 문의는 아래 메일로.</Text>
          <Pressable
            style={styles.partnerMailRow}
            onPress={() => {
              haptics.tap();
              Linking.openURL(`mailto:${PARTNER_EMAIL}`).catch(() => {});
            }}
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#3182f6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <Rect x={2} y={4} width={20} height={16} rx={2} />
              <Path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </Svg>
            <Text style={styles.partnerMail}>{PARTNER_EMAIL}</Text>
          </Pressable>
        </View>

        {/* 카카오톡 채널 */}
        <View style={styles.kakaoCard}>
          <View style={styles.kakaoIcon}>
            <Svg width={28} height={28} viewBox="0 0 24 24" fill="#3A1D1D">
              <Path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.73 1.7 5.13 4.26 6.54l-1.08 3.98 4.64-3.06c.7.1 1.44.15 2.18.15 5.523 0 10-3.477 10-7.8S17.523 3 12 3z" />
            </Svg>
          </View>
          <View style={styles.kakaoInfo}>
            <Text style={styles.kakaoTitle}>카카오톡 고객센터</Text>
            <Text style={styles.kakaoSub}>24시간 운영</Text>
          </View>
          <Pressable
            style={styles.kakaoBtn}
            onPress={() => {
              haptics.tap();
              Linking.openURL(KAKAO_CHANNEL_URL).catch(() => {});
            }}
          >
            <Text style={styles.kakaoBtnText}>채팅하기</Text>
          </Pressable>
        </View>
      </ScrollView>
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
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  faqList: { marginBottom: 24 },
  faqItem: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  faqQ: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    gap: 8,
  },
  faqQText: { flex: 1, fontSize: 14.5, fontWeight: '700', color: '#1e293b', lineHeight: 21 },
  faqChevron: { fontSize: 20, color: '#94a3b8', transform: [{ rotate: '90deg' }] },
  faqChevronOpen: { transform: [{ rotate: '-90deg' }] },
  faqA: { fontSize: 13.5, color: '#64748b', lineHeight: 21, paddingBottom: 14 },
  partnerCard: {
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    marginBottom: 16,
  },
  partnerEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563eb',
    marginBottom: 8,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  partnerTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  partnerSub: { fontSize: 13, color: '#64748b', marginBottom: 14 },
  partnerMailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  partnerMail: { fontSize: 13, fontWeight: '600', color: '#2563eb' },
  kakaoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FEE500',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  kakaoIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kakaoInfo: { flex: 1 },
  kakaoTitle: { fontSize: 15, fontWeight: '800', color: '#3A1D1D' },
  kakaoSub: { fontSize: 12, color: 'rgba(58,29,29,0.7)', marginTop: 2 },
  kakaoBtn: {
    backgroundColor: '#3A1D1D',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  kakaoBtnText: { color: '#FEE500', fontSize: 13, fontWeight: '800' },
});
