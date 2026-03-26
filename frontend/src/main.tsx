import './i18n';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';
import 'highlight.js/styles/github-dark-dimmed.min.css';

createRoot(document.getElementById('root')!).render(<App />);
