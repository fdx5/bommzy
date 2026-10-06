import './ui/styles.css';
import { App } from './app';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

// block pinch-zoom / double-tap zoom / long-press menus during play
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); });

const app = new App(canvas, ui);
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
