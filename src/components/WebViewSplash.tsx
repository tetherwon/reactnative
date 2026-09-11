import { Image, StyleSheet, Text, View } from 'react-native';

// 웹 스플래시(_splash.html)와 같은 그림. 웹뷰가 뜨는 순간 화면이 바뀌지 않는다.
//
// ⚠️ 배율 접미사가 없는 단일 에셋을 쓰면 안 된다. 그런 에셋은 drawable-mdpi 로
// 들어가고 안드로이드가 기기 배율만큼 확대해서 디코딩한다 — 원본 600×1087 하나만
// 두면 3x 기기에서 22MB 비트맵이 잡힌다(250×453dp 로 그리는데도).
// 표시 크기(시안 393×852 의 63.61%×53.17% = 250×453dp)에 맞춘 배율별 에셋을 두면
// 각 기기가 1:1로 디코딩해 3x 에서도 3.9MB 로 줄고, RN 이 알아서
// mdpi/xhdpi/xxhdpi 폴더로 나눠 넣는다. @2x/@3x 파일을 함께 유지할 것.
const SPLASH_BEAR = require('../../assets/images/splash-bear.png');

export default function WebViewSplash() {
  return (
    <View style={styles.loader} pointerEvents="none">
      <Text style={styles.loadingLine1}>쇼핑 적립은,</Text>
      <Text style={styles.loadingLine2}>Shoppinglog</Text>
      <Image source={SPLASH_BEAR} style={styles.loadingBear} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  // 웹 스플래시(templates/partials/_splash.html)와 같은 화면.
  // 예전엔 곰 얼굴 + '쇼핑적립은 쇼핑로그' 한 줄이라, 웹뷰가 뜨는 순간 웹 스플래시로
  // 바뀌면서 그림·문구·배경색(#1371F9→#3182f6)이 한꺼번에 갈아끼워져 깜빡였다.
  // 좌표는 웹과 같은 시안(393×852) 기준 %라 기기 높이가 달라도 같이 움직인다.
  loader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    backgroundColor: '#3182f6',
  },
  loadingLine1: {
    position: 'absolute',
    top: '24.18%',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#ffffff',
    fontSize: 24,
    lineHeight: 24,
    letterSpacing: -0.48,
  },
  loadingLine2: {
    position: 'absolute',
    top: '29.23%',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#ffffff',
    fontSize: 36,
    lineHeight: 36,
    // 웹은 Poppins를 지정하지만 실제로 로드하는 폰트가 없어 Pretendard로 떨어진다.
    // 앱에 임베드된 Pretendard-Black을 쓰면 웹에서 보이는 것과 같은 글자가 된다.
    fontFamily: 'Pretendard-Black',
  },
  // 시안 250×453 @ (143,364). 이미지 비율(600×1087)이 이 상자와 같아
  // resizeMode='contain'이 웹의 object-fit:contain + left top 과 같은 결과가 된다.
  loadingBear: {
    position: 'absolute',
    left: '36.39%',
    top: '42.72%',
    width: '63.61%',
    height: '53.17%',
  },
});
