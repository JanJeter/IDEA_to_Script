import React from 'react';
import ReactDOM from 'react-dom/client';
import type { ErrorInfo, ReactNode } from 'react';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource/playfair-display/latin-600.css';
import '@fontsource/playfair-display/latin-400-italic.css';
import './styles.css';
import App from './App';

class RootErrorBoundary extends React.Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('UI crashed', error, info); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main style={{ padding: 32 }}><h1>页面需要重新加载</h1><p>刚才的页面资源或数据出现异常。</p><button onClick={() => window.location.reload()}>重新加载</button></main>;
  }
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary><App /></RootErrorBoundary>
  </React.StrictMode>,
);
