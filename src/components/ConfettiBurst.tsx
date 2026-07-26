import { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// 웹 roulette-inline-1.js 의 fireConfetti() 대응 — 화면 상단 1/3 지점에서
// 사각 조각을 중력과 함께 터뜨린다. 새 네이티브 의존성 없이 reanimated 로 구현.
// burstKey 가 바뀔 때마다 count 만큼 파티클을 새로 발사한다(0이면 아무 것도 안 함).

const COLORS = ['#facc15', '#2563eb', '#10b981', '#ef4444', '#a855f7'];
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

type Particle = {
  key: string;
  color: string;
  size: number;
  dx: number;
  rise: number;
  fall: number;
  rot: number;
};

function makeParticles(count: number, seed: number): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    // 결정적 의사난수(스핀별 seed 로 매번 다른 모양)
    const r1 = ((Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1;
    const r2 = ((Math.sin(seed * 39.346 + i * 11.135) * 24634.6345) % 1 + 1) % 1;
    const r3 = ((Math.sin(seed * 4.898 + i * 27.611) * 95632.1234) % 1 + 1) % 1;
    out.push({
      key: `${seed}-${i}`,
      color: COLORS[i % COLORS.length],
      size: 6 + r1 * 7,
      dx: (r2 - 0.5) * SCREEN_W * 1.1,
      rise: 60 + r3 * 140,
      fall: SCREEN_H * (0.55 + r1 * 0.4),
      rot: (r2 - 0.5) * 8,
    });
  }
  return out;
}

function ConfettiPiece({ p, progress }: { p: Particle; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const t = progress.value;
    return {
      opacity: interpolate(t, [0, 0.75, 1], [1, 1, 0]),
      transform: [
        { translateX: interpolate(t, [0, 1], [0, p.dx]) },
        { translateY: interpolate(t, [0, 0.28, 1], [0, -p.rise, p.fall]) },
        { rotate: `${interpolate(t, [0, 1], [0, p.rot])}rad` },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: SCREEN_W / 2,
          top: SCREEN_H / 3,
          width: p.size,
          height: p.size * 0.6,
          backgroundColor: p.color,
          borderRadius: 1,
        },
        style,
      ]}
    />
  );
}

export default function ConfettiBurst({ burstKey, count }: { burstKey: number; count: number }) {
  const particles = useMemo(
    () => (burstKey > 0 && count > 0 ? makeParticles(count, burstKey) : []),
    [burstKey, count],
  );
  const progress = useSharedValue(0);

  useEffect(() => {
    if (burstKey > 0 && count > 0) {
      progress.value = 0;
      progress.value = withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) });
    }
  }, [burstKey, count, progress]);

  if (particles.length === 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {particles.map((p) => (
        <ConfettiPiece key={p.key} p={p} progress={progress} />
      ))}
    </View>
  );
}
