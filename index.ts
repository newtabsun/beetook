import './src/lib/livekitInit';
import { registerRootComponent } from 'expo';
import App from './App';
import { withErrorBoundary } from './src/components/CrashGuard';
import { createElement } from 'react';
import { KeyboardInset } from './src/components/KeyboardInset';

const Root = () => createElement(KeyboardInset, { style: { backgroundColor: '#000' }, children: createElement(App) });
registerRootComponent(withErrorBoundary(Root));
