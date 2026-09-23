import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { APP_URL as CONFIGURED_URL } from './config';

// The mobile app is a thin native shell around the hosted web app, so web and mobile always share
// the same accounts, data and UI. Set the address in config.ts.
const APP_URL: string = CONFIGURED_URL.trim().replace(/\/+$/, '');

const colors = {
  brand: '#4F46E5',
  light: { bg: '#FFFFFF', text: '#0F172A', muted: '#64748B' },
  dark: { bg: '#0B0F19', text: '#F1F5F9', muted: '#94A3B8' },
};

function Message({ title, body, action, onAction, dark }: { title: string; body: string; action?: string; onAction?: () => void; dark: boolean }) {
  const theme = dark ? colors.dark : colors.light;
  return (
    <View style={[styles.center, { backgroundColor: theme.bg }]}>
      <View style={styles.logo}><Text style={styles.logoMark}>✓</Text></View>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.body, { color: theme.muted }]}>{body}</Text>
      {action && onAction ? (
        <Pressable style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]} onPress={onAction}>
          <Text style={styles.buttonText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function App() {
  const dark = useColorScheme() === 'dark';
  const theme = dark ? colors.dark : colors.light;
  const webRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [failed, setFailed] = useState(false);
  const appHost = APP_URL ? APP_URL.replace(/^https?:\/\//, '').split('/')[0] : '';

  // Android hardware back button navigates inside the web app first.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && webRef.current) {
        webRef.current.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  // Keep our own site (and the Razorpay checkout) in the app; open everything else outside.
  const onShouldStart = useCallback((req: { url: string }) => {
    const url = req.url;
    if (url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) return true;
    const match = url.match(/^https?:\/\/([^/?#]+)/);
    if (match) {
      const host = match[1];
      if (host === appHost || host.endsWith('razorpay.com')) return true;
    }
    Linking.openURL(url).catch(() => {});
    return false;
  }, [appHost]);

  const onNav = useCallback((nav: WebViewNavigation) => setCanGoBack(nav.canGoBack), []);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} backgroundColor={theme.bg} />
      {!APP_URL ? (
        <Message dark={dark} title="Almost ready" body="Set APP_URL in apps/mobile/config.ts to your Task Tracker address (for example https://your-app.vercel.app), then restart the app." />
      ) : failed ? (
        <Message dark={dark} title="You're offline" body="Task Tracker couldn't reach the server. Check your connection and try again." action="Try again" onAction={() => { setFailed(false); webRef.current?.reload(); }} />
      ) : (
        <WebView
          ref={webRef}
          source={{ uri: APP_URL }}
          style={{ flex: 1, backgroundColor: theme.bg }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          allowsBackForwardNavigationGestures
          pullToRefreshEnabled
          setSupportMultipleWindows={false}
          applicationNameForUserAgent="TaskTrackerMobile"
          startInLoadingState
          renderLoading={() => (
            <View style={[styles.center, StyleSheet.absoluteFill, { backgroundColor: theme.bg }]}>
              <ActivityIndicator color={colors.brand} />
            </View>
          )}
          onNavigationStateChange={onNav}
          onShouldStartLoadWithRequest={onShouldStart}
          onError={() => setFailed(true)}
          onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  logo: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  logoMark: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 320 },
  button: { marginTop: 24, height: 44, paddingHorizontal: 24, borderRadius: 8, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', minWidth: 200 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
