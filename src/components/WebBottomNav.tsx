import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { isNativeScreenEnabled } from '@/lib/api';
import * as haptics from '@/lib/haptics';

// 웹 partials/_bottom_nav.html 을 그대로 옮긴 네이티브 하단 네비.
// 아이콘 SVG 패스·색·크기 모두 웹과 동일 (styles.css .bottom-nav 값 기준).
// 네이티브 화면이 있는 탭은 네이티브로, 나머지는 웹뷰 경로로 보낸다.

const MUTED = '#8b95a1';
const ACTIVE = '#191f28';

function openWeb(path: string) {
  router.navigate({ pathname: '/', params: { navUrl: path, navTs: String(Date.now()) } });
}

type TabKey = 'home' | 'point-draw' | 'discount-log' | 'benefit' | 'profile';

// 각 탭의 네이티브 라우트(있으면) — native_screens 스위치가 켜져 있을 때만 사용
const NATIVE_ROUTES: Partial<Record<TabKey, { screen: string; route: string }>> = {
  benefit: { screen: 'benefit', route: '/benefit' },
};

const WEB_PATHS: Record<TabKey, string> = {
  home: '/',
  'point-draw': '/point-draw',
  'discount-log': '/discount-log',
  benefit: '/benefit',
  profile: '/profile',
};

function Icon({ tab, color }: { tab: TabKey; color: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (tab) {
    case 'home':
      return (
        <Svg {...common}>
          <Path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
          <Path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </Svg>
      );
    case 'point-draw':
      return (
        <Svg {...common}>
          <Circle cx={12} cy={12} r={9} />
          <Path d="M9.5 16.5V7.5h3a2.4 2.4 0 0 1 0 4.8h-3" />
        </Svg>
      );
    case 'discount-log':
      return (
        <Svg {...common} width={28} height={28} stroke="#ffffff">
          <Path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
          <Path d="m15 9-6 6" />
          <Path d="M9 9h.01" />
          <Path d="M15 15h.01" />
        </Svg>
      );
    case 'benefit':
      return (
        <Svg {...common}>
          <Path d="M12 7v14" />
          <Path d="M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" />
          <Path d="M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5" />
          <Path d="M3 7h18v4H3z" />
        </Svg>
      );
    case 'profile':
      return (
        <Svg {...common}>
          <Path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <Circle cx={12} cy={7} r={4} />
        </Svg>
      );
  }
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'home', label: '홈' },
  { key: 'point-draw', label: '포인트 뽑기' },
  { key: 'discount-log', label: '할인로그' },
  { key: 'benefit', label: '혜택' },
  { key: 'profile', label: '내 정보' },
];

export default function WebBottomNav({ active }: { active?: TabKey }) {
  const insets = useSafeAreaInsets();

  const onTab = (tab: TabKey) => {
    if (tab === active) return;
    haptics.tap();
    const native = NATIVE_ROUTES[tab];
    if (native && isNativeScreenEnabled(native.screen)) {
      // 웹뷰를 경유하지 않고 네이티브 화면 간 직접 전환
      router.replace(native.route);
      return;
    }
    openWeb(WEB_PATHS[tab]);
  };

  return (
    <View style={[styles.nav, { height: 60 + insets.bottom, paddingBottom: insets.bottom }]}>
      {TABS.map(({ key, label }) => {
        const isActive = key === active;
        const color = isActive ? ACTIVE : MUTED;
        return (
          <Pressable key={key} style={styles.item} onPress={() => onTab(key)}>
            {key === 'discount-log' ? (
              <View style={styles.centerBtn}>
                <Icon tab={key} color="#ffffff" />
              </View>
            ) : (
              <Icon tab={key} color={color} />
            )}
            <Text style={[styles.label, { color }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e5e8eb',
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 10,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: { fontSize: 11, fontWeight: '500' },
  centerBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3182f6',
    shadowColor: '#3182f6',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    marginTop: -14,
    marginBottom: 2,
  },
});
