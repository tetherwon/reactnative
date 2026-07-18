import { StyleSheet, Text, View } from 'react-native';

// 웹 미리보기(react-native-web) 전용 — 웹뷰 셸(react-native-webview)은
// 네이티브 전용이라 웹 번들에서 제외한다. 네이티브 화면들(/benefit, /roulette 등)은
// 웹 미리보기에서 직접 URL로 열어 레이아웃을 확인한다.
export default function HomeScreenWeb() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>웹 미리보기에서는 웹뷰 화면을 지원하지 않아요.</Text>
      <Text style={styles.sub}>/benefit, /roulette 등 네이티브 화면 경로로 이동해 확인하세요.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', gap: 6 },
  text: { fontSize: 15, fontWeight: '700', color: '#191f28' },
  sub: { fontSize: 13, color: '#8b95a1' },
});
