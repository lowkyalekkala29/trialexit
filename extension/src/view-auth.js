/**
 * Sign up / sign in — passwordless. Google, Microsoft, or a 6-digit code.
 */
import { state, esc, IS_WEB, save } from './state.js';
import { CLOUD_ENABLED } from './config.js';
import { sendCode, verifyCode, signInWithProvider } from './auth.js';

const GOOGLE = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
const MICROSOFT = `<svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>`;

export function authHtml(mode) {
  const a = state.auth;
  a.mode = mode;
  const signup = mode === 'signup';
  const legal = IS_WEB ? '../' : 'https://trialexit.app/';
  const body =
    a.stage === 'code'
      ? `<form class="auth-form" data-form="verify">
          <p class="lede" style="margin:0">We sent a 6-digit code to <b>${esc(a.email)}</b>. It expires in 10 minutes.</p>
          ${CLOUD_ENABLED ? '' : '<p class="banner" style="margin:0">Preview mode: no email is sent. Enter any 6 digits.</p>'}
          <label>Verification code
            <input id="auth-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" placeholder="123456" required autofocus />
          </label>
          <button class="primary block" type="submit" ${a.busy ? 'disabled' : ''}>${a.busy ? 'Checking…' : 'Verify and continue'}</button>
          <div class="row-between"><button type="button" class="link" data-act="auth-back">Use a different email</button>
          <button type="button" class="link" data-act="auth-resend">Resend code</button></div>
        </form>`
      : `<div class="auth-providers">
          <button class="block" data-act="auth-provider" data-provider="google">${GOOGLE} Continue with Google</button>
          <button class="block" data-act="auth-provider" data-provider="azure">${MICROSOFT} Continue with Microsoft</button>
        </div>
        <div class="divider"><span>or</span></div>
        <form class="auth-form" data-form="email">
          <label>Email
            <input id="auth-email" type="email" autocomplete="email" placeholder="you@example.com" value="${esc(a.email)}" required />
          </label>
          <button class="primary block" type="submit" ${a.busy ? 'disabled' : ''}>${a.busy ? 'Sending…' : 'Continue with email'}</button>
        </form>`;

  return `<div class="auth">
    <aside class="auth-side">
      <div class="brand"><span class="mark">✓</span><span class="brand-name">TrialExit</span></div>
      <div>
        <h2>Never pay for a free trial you forgot to cancel.</h2>
        <ul class="ticks">
          <li>Catches trials as you sign up — on any website, and in Gmail or Outlook</li>
          <li>Nudges at 2 days, 1 day, 6 hours and 1 hour before the charge</li>
          <li>One click opens the exact cancel page</li>
          <li>No bank access. Your email is read on your device, never uploaded.</li>
        </ul>
      </div>
      <p class="hint">Free during launch.</p>
    </aside>
    <main class="auth-main">
      <div class="auth-card">
        <div class="brand mobile-only"><span class="mark">✓</span><span class="brand-name">TrialExit</span></div>
        <h1>${a.stage === 'code' ? 'Check your email' : signup ? 'Create your account' : 'Welcome back'}</h1>
        <p class="lede">${a.stage === 'code' ? '' : signup ? 'Start catching trials in under a minute. No password needed.' : 'Sign in to see your trials.'}</p>
        ${a.error ? `<p class="error" role="alert">${esc(a.error)}</p>` : ''}
        ${body}
        ${a.stage === 'code' ? '' : `<p class="switch">${signup ? 'Already have an account? <a href="#/signin">Sign in</a>' : 'New to TrialExit? <a href="#/signup">Create an account</a>'}</p>`}
        ${!IS_WEB && a.stage !== 'code' ? '<p class="switch"><button class="link" data-act="auth-skip">Continue without an account</button><br><span class="hint">Works fully on this device. Sign in later to sync and get email reminders.</span></p>' : ''}
        <p class="legal">By continuing you agree to our <a href="${legal}terms.html" target="_blank" rel="noopener">Terms</a> and <a href="${legal}privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</p>
      </div>
    </main>
  </div>`;
}

function friendly(err) {
  const m = String(err?.message ?? err);
  if (/rate|too many|security purposes/i.test(m)) return 'Too many attempts — wait a minute and try again.';
  if (/expired|invalid|otp/i.test(m)) return 'That code is wrong or expired. Check the latest email, or resend.';
  if (/fetch|network/i.test(m)) return "Can't reach the server. Check your connection.";
  return m;
}

/** @param {(path:string)=>void} go */
export function authActions(go, afterSignIn) {
  // Read inputs BEFORE re-rendering: the busy re-render replaces the form.
  const val = (id) => /** @type {HTMLInputElement|null} */ (document.getElementById(id))?.value?.trim() ?? '';
  const run = async (fn) => {
    state.auth.busy = true;
    state.auth.error = '';
    document.querySelectorAll('.auth button').forEach((b) => (/** @type {HTMLButtonElement} */ (b).disabled = true));
    try {
      await fn();
    } catch (err) {
      state.auth.error = friendly(err);
    }
    state.auth.busy = false;
    go(null);
  };
  return {
    'auth-provider': (el) =>
      run(async () => {
        const s = await signInWithProvider(/** @type {any} */ (el.dataset.provider));
        if (s) await afterSignIn(s);
      }),
    'auth-back': () => {
      state.auth.stage = 'start';
      state.auth.error = '';
      go(null);
    },
    'auth-resend': () =>
      run(async () => {
        await sendCode(state.auth.email);
        state.auth.error = '';
      }),
    'auth-skip': async () => {
      state.settings.accountSkipped = true;
      await save();
      go('#/onboarding/1');
    },
    'form:email': () => {
      const email = val('auth-email').toLowerCase();
      return run(async () => {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address');
        state.auth.email = email;
        await sendCode(email);
        state.auth.stage = 'code';
      });
    },
    'form:verify': () => {
      const code = val('auth-code');
      return run(async () => {
        const s = await verifyCode(state.auth.email, code);
        state.auth.stage = 'start';
        await afterSignIn(s);
      });
    },
  };
}
