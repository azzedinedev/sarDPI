/**
 * Login — carte glass animée, blobs, captcha SVG (audio en secours), 2FA TOTP, lien mot de passe oublié.
 * Les messages d'erreur affichent la traduction du CODE serveur (« auth.* », « errors.* »), jamais le texte brut.
 */
'use client';
import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Volume2 } from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { useT, useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';
import { cn } from '@/lib/utils';

function LoginForm(): React.ReactElement {
  const router = useRouter();
  const sp = useSearchParams();
  const login = useAuth((s) => s.login);
  const status = useAuth((s) => s.status);
  const error = useAuth((s) => s.error);
  const { t } = useT('auth');
  const { lang, languages, setLang } = useI18n();
  const [identifier, setId] = useState('');
  const [password, pw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [captchaId, setCaptchaId] = useState<string | null>(null);
  const [captchaSvg, setCaptchaSvg] = useState<string | null>(null);
  const [captchaSol, setCaptchaSol] = useState('');
  const [question, setQuestion] = useState('');
  const [totpCode, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const errRef = useRef<HTMLDivElement>(null);

  const needTotp = status === 'needs-totp';

  const loadCaptcha = (): void => {
    void api
      .get<{ provider: string; id?: string; svg?: string; question?: string; sitekey?: string }>('/auth/captcha')
      .then((c) => {
        setCaptchaId(c.id ?? null);
        setCaptchaSvg(c.svg ?? null);
        setQuestion(c.question ?? '');
      })
      .catch(() => undefined);
  };
  useEffect(loadCaptcha, []);

  useEffect(() => {
    if (error && errRef.current) errRef.current.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(0)' }], { duration: 240 });
  }, [error]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    try {
      if (needTotp) {
        // login porte aussi le code (étape 2) : le serveur accepte totpCode sur /auth/login après pending
        await login(identifier, password, { totp: totpCode });
      } else {
        await login(identifier, password, captchaId ? { captchaId, captchaValue: captchaSol } : {});
      }
      const next = sp.get('next') ?? '/dashboard';
      router.replace(next.startsWith('/') ? next : '/dashboard');
    } catch {
      loadCaptcha();
      setCaptchaSol('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden p-4">
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="bg-blob left-[-8%] top-[-12%] h-[46vw] w-[46vw] bg-[rgb(var(--c-primary)/0.35)]" />
        <div className="bg-blob blob-2 bottom-[-16%] end-[-6%] h-[40vw] w-[40vw] bg-[rgb(var(--c-mint)/0.3)]" />
      </div>

      <motion.div initial={{ opacity: 0, y: 18, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="w-full max-w-[420px]">
        <div className="glass-card relative p-6 shadow-[var(--shadow-lift)]">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[rgb(var(--c-primary))] text-[19px] font-bold text-[rgb(var(--c-primary-ink))] shadow-[var(--shadow-glow)]">S</span>
              <div>
                <div className="text-[17px] font-bold leading-tight">sarDPI</div>
                <div className="text-[11px] font-medium text-[rgb(var(--c-muted))]">{t('login.subtitle')}</div>
              </div>
            </div>
            <div className="flex gap-1">
              {languages.map((l) => (
                <button
                  key={l.code}
                  onClick={() => void setLang(l.code)}
                  className={cn('rounded-lg px-2 py-1 text-[11px] font-bold uppercase transition-colors', l.code === lang ? 'bg-[rgb(var(--c-primary))] text-white' : 'text-[rgb(var(--c-muted))] hover:bg-[rgb(var(--c-surface-2))]')}
                >
                  {l.code}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <div ref={errRef} role="alert" className="mb-3 rounded-xl border border-[rgb(var(--c-coral)/0.4)] bg-[rgb(var(--c-coral-soft))] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--c-coral))]">
              {t(error)}
            </div>
          ) : null}

          <form onSubmit={(e) => void submit(e as unknown as React.FormEvent)} className="flex flex-col gap-3.5">
            {!needTotp ? (
              <>
                <Field label={t('login.identifier')}>
                  <Input autoFocus value={identifier} onChange={(e) => setId(e.target.value)} autoComplete="username" required placeholder={t('login.identifierPlaceholder')} />
                </Field>
                <Field label={t('login.password')}>
                  <div className="relative">
                    <Input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => pw(e.target.value)} autoComplete="current-password" required placeholder="••••••••" />
                    <button type="button" className="absolute top-1/2 -translate-y-1/2 text-[rgb(var(--c-muted))] hover:text-[rgb(var(--c-ink))] ltr:right-2.5 rtl:left-2.5" onClick={() => setShowPw((v) => !v)} aria-label="show password">
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>
                {captchaSvg ? (
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Field label={t('captcha.question')} hint={t('captcha.hint')}>
                        <Input value={captchaSol} onChange={(e) => setCaptchaSol(e.target.value)} inputMode="numeric" placeholder="6824" />
                      </Field>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="overflow-hidden rounded-xl border border-[rgb(var(--c-line))] bg-white [&>svg]:block" dangerouslySetInnerHTML={{ __html: captchaSvg }} />
                      <div className="flex gap-1">
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={loadCaptcha} title={t('captcha.refresh')}>
                          <Loader2 size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-icon"
                          title={t('captcha.audio')}
                          onClick={() => {
                            // secours audio : lecture vocale de la question (Web Speech API, locale, 100 % hors-ligne)
                            if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
                            const u = new SpeechSynthesisUtterance(`${question}. Répétez le résultat.`);
                            u.lang = lang === 'ar' ? 'ar-SA' : lang === 'es' ? 'es-ES' : lang === 'en' ? 'en-US' : 'fr-FR';
                            window.speechSynthesis.speak(u);
                          }}
                        >
                          <Volume2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <Field label={t('login.otp')} hint={t('login.otpHint')}>
                <div className="relative">
                  <ShieldCheck size={16} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[rgb(var(--c-muted))] ltr:left-3 rtl:right-3" />
                  <Input autoFocus className="ps-9 text-center font-mono tracking-[0.5em]" maxLength={6} inputMode="numeric" pattern="[0-9]{6}" value={totpCode} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} required />
                </div>
              </Field>
            )}

            <Button type="submit" variant="primary" loading={busy} className="mt-1 w-full" disabled={!needTotp && (!identifier || !password)}>
              <KeyRound size={16} /> {needTotp ? t('login.verify') : t('login.submit')}
            </Button>
            {needTotp ? (
              <button type="button" className="text-[12.5px] font-semibold text-[rgb(var(--c-primary))] underline-offset-2 hover:underline" onClick={() => window.location.replace('/login')}>
                {t('login.back')}
              </button>
            ) : (
              <Link href="/forgot" className="self-center text-[12.5px] font-medium text-[rgb(var(--c-muted))] hover:text-[rgb(var(--c-primary))] hover:underline">
                {t('forgot.link')}
              </Link>
            )}
          </form>
        </div>
        <p className="mt-3 text-center text-[11px] text-[rgb(var(--c-muted))]">{t('login.footer')}</p>
      </motion.div>
    </div>
  );
}

export default function LoginPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
