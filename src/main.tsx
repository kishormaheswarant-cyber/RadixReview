import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { CurrencyProvider } from './lib/currency.tsx';
import { FirebaseProvider } from './lib/firebaseContext.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <FirebaseProvider>
      <CurrencyProvider>
        <App />
      </CurrencyProvider>
    </FirebaseProvider>
  </ErrorBoundary>,
);
