import { Component, type ComponentType, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { friendlyError } from '../lib/errors';

/** Startup step marker (kept for callers; no global side effects). */
export function setStage(_next: string) {}

function format(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}\n\n${e.stack ?? ''}`;
  return String(e);
}

/** Logs a non-render error; does not intercept React Native's global error handling. */
export function reportFatal(e: unknown) {
  console.error(format(e));
}

/** Rejects if `p` does not settle within `ms`. */
export function withTimeout<T>(p: Promise<T>, label: string, ms = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Startup step timed out after ${ms / 1000}s: ${label}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function ErrorView({ msg }: { msg: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#000', paddingTop: 48, paddingHorizontal: 16 }}>
      <Text style={{ color: '#ff8a00', fontSize: 20, fontWeight: '700', marginBottom: 12 }}>Bee Took startup error</Text>
      <Text style={{ color: '#fff', marginBottom: 12 }}>Please screenshot this screen and send it to support.</Text>
      <ScrollView>
        <Text selectable style={{ color: '#fff', fontFamily: 'monospace', fontSize: 12 }}>{msg}</Text>
      </ScrollView>
    </View>
  );
}

class Boundary extends Component<{ children: ReactNode }, { msg: string | null }> {
  state = { msg: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    console.error(format(e));
    return { msg: friendlyError(e) };
  }
  render() {
    return this.state.msg ? <ErrorView msg={this.state.msg} /> : this.props.children;
  }
}

/** Wraps the statically imported root component in a plain render-error boundary. */
export function withErrorBoundary(App: ComponentType) {
  return function Guarded() {
    return (
      <Boundary>
        <App />
      </Boundary>
    );
  };
}
