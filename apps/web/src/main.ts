import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err: unknown) => {
  console.error(err);
  showStartupFailure();
});

/**
 * If the app cannot start at all, show a plain page with a Reload button instead of a blank
 * screen. Built with DOM calls (no inline script), so it works under our CSP.
 */
function showStartupFailure(): void {
  const box = document.createElement('main');
  box.setAttribute('role', 'alert');
  box.style.cssText =
    'min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:12px;padding:24px;text-align:center;background:#f6f3ee;color:#1c1917;' +
    'font-family:Inter,system-ui,sans-serif';
  const title = document.createElement('h1');
  title.textContent = 'MandapamBook could not load';
  title.style.cssText =
    'font-family:Fraunces,Georgia,serif;font-weight:400;font-size:28px;margin:0';
  const text = document.createElement('p');
  text.textContent =
    'Something went wrong while opening the site. Check your connection and try again.';
  text.style.cssText = 'margin:0;max-width:28rem;color:#433d38;line-height:1.6';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Reload';
  button.style.cssText =
    'margin-top:8px;padding:12px 28px;border:0;border-radius:999px;background:#c2410c;' +
    'color:#fff;font-weight:600;font-size:16px;cursor:pointer';
  button.addEventListener('click', () => location.reload());
  box.append(title, text, button);
  document.querySelector('app-root')?.remove();
  document.body.append(box);
}
