/**
 * Login — carte glass animée, blobs, captcha (interne SVG ou widget hCaptcha/Turnstile/reCAPTCHA),
 * 2FA TOTP, lien mot de passe oublié.
 * Les messages d'erreur affichent la traduction du CODE serveur (« auth.* », « errors.* »), jamais le texte brut.
 *
 * Le captcha n'est PAS décidé ici : `GET /auth/captcha` renvoie le fournisseur EFFECTIF (repli
 * interne compris en cas de clés manquantes) et sa clé publique. L'écran monte donc soit le défi
 * interne (SVG + question), soit le widget externe — dans les deux cas, le jeton envoyé à
 * `POST /auth/login` correspond exactement à ce que le serveur va vérifier.
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
import { ExternalCaptcha } from '@/components/external-captcha';
import { captchaNeedsToken, captchaPayload, type CaptchaInfo, type CaptchaProviderName } from '@/lib/captcha-client';
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
  /** Saisie du défi interne (calcul affiché dans le SVG). */
  const [captchaSol, setCaptchaSol] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaInfo | null>(null);
  /** Jeton du widget externe (hCaptcha/Turnstile/reCAPTCHA) — vide tant que le défi n'est pas résolu. */
  const [captchaToken, setCaptchaToken] = useState('');
  /** Incrémenté pour remettre le défi externe à zéro (échec de connexion, changement de fournisseur). */
  const [captchaReset, setCaptchaReset] = useState(0);
  const [captchaBlocked, setCaptchaBlocked] = useState(false);
  const [totpCode, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const errRef = useRef<HTMLDivElement>(null);
  /**
   * Motif de la redirection (lib/session-gate) : « ended » = session interrompue côté serveur
   * (révoquée, compte fermé / désactivé), « expired » = aucune session valide (expirée, cookie
   * effacé, navigateur rouvert). On l'explique ici pour que l'utilisateur ne soit pas devant un
   * écran de connexion sans raison apparente.
   */
  const reason = sp.get('reason');

  const needTotp = status === 'needs-totp';

  const loadCaptcha = (): void => {
    void api
      .get<CaptchaInfo>('/auth/captcha')
      .then((c) => {
        setCaptcha(c);
        setCaptchaToken('');
        setCaptchaBlocked(false);
        // Un défi interne est à usage unique : le remonter évite de réutiliser l'ancien après un échec.
        setCaptchaReset((n) => n + 1);
      })
      .catch(() => undefined);
  };
  useEffect(loadCaptcha, []);

  /**
   * Secours audio du défi : lecture vocale de la question (Web Speech API — synthèse locale du
   * navigateur, aucun service tiers, donc compatible on-prem / hors-ligne).
   */
  const speakQuestion = (): void => {
    const question = captcha?.question ?? '';
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !question) return;
    window.speechSynthesis.cancel();
    const text =
      captcha?.mode === 'image'
        ? t('captcha.speakLetters', { letters: question })
        : t('captcha.speak', { question });
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'ar' ? 'ar-SA' : lang === 'es' ? 'es-ES' : lang === 'en' ? 'en-US' : 'fr-FR';
    window.speechSynthesis.speak(u);
  };

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
        // Le champ attendu dépend du fournisseur EFFECTIF : captchaId/Valeur (interne) ou le jeton
        // du widget externe. Un défi non résolu n'envoie rien — le serveur refusera, l'écran explique.
        await login(identifier, password, captchaPayload(captcha, { token: captchaToken, id: captcha?.id, value: captchaSol }));
      }
      const next = sp.get('next') ?? '/dashboard';
      const target = next.startsWith('/') && !next.startsWith('/login') ? next : '/dashboard';
      window.location.replace(target);
    } catch {
      // Nouveau défi après un échec (interne comme externe) : l'ancien est soit consommé, soit expiré.
      setCaptchaSol('');
      loadCaptcha();
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

          {/* Configuration captcha incomplète : le serveur a replié sur le défi interne (aucun
              verrouillage possible) ; on le signale pour que l'administrateur corrige les clés. */}
          {captcha?.fallback && !error ? (
            <div role="status" className="mb-3 rounded-xl border border-[rgb(var(--c-amber)/0.45)] bg-[rgb(var(--c-amber-soft))] px-3 py-2 text-[12.5px] font-semibold text-[rgb(var(--c-amber))]">
              {t('captcha.fallbackNotice', { provider: captcha.requested ?? '' })}
            </div>
          ) : null}

          {reason && !error ? (
            <div role="status" className="mb-3 rounded-xl border border-[rgb(var(--c-info)/0.4)] bg-[rgb(var(--c-info-soft))] px-3 py-2 text-[12.5px] font-semibold text-[rgb(var(--c-info))]">
              {reason === 'expired' ? t('auth.sessionRequiredNotice') : t('auth.sessionEndedNotice')}
            </div>
          ) : null}

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
                    <button type="button" className="absolute top-1/2 -translate-y-1/2 text-[rgb(var(--c-muted))] hover:text-[rgb(var(--c-ink))] ltr:right-2.5 rtl:left-2.5" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? t('login.hidePassword') : t('login.showPassword')}
                    title={showPw ? t('login.hidePassword') : t('login.showPassword')}>
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>
                {captcha && captcha.provider !== 'none' && captcha.provider !== 'internal' && captcha.sitekey ? (
                  <Field label={t('captcha.question')} hint={t('captcha.externalHint')}>
                    <ExternalCaptcha
                      provider={captcha.provider}
                      sitekey={captcha.sitekey}
                      lang={lang}
                      resetKey={captchaReset}
                      onToken={(tok) => {
                        setCaptchaToken(tok);
                        setCaptchaBlocked(false);
                      }}
                      onError={() => setCaptchaBlocked(true)}
                    />
                  </Field>
                ) : null}
                {captcha?.provider === 'internal' && captcha.svg ? (
                  <Field
                    label={captcha.mode === 'image' ? t('captcha.imageQuestion') : t('captcha.question')}
                    hint={captcha.mode === 'image' ? t('captcha.imageHint') : t('captcha.hint')}
                  >
                    {/* Saisie, défi visuel et actions sur UNE seule ligne, tous à la hauteur d'un
                        champ (var(--row-h)) : l'ancien empilement image+boutons désalignait le tout. */}
                    <div className="flex items-center gap-2">
                      <Input
                        className="min-w-0 flex-1 font-mono tracking-wider uppercase"
                        value={captchaSol}
                        onChange={(e) =>
                          setCaptchaSol(
                            captcha.mode === 'image'
                              ? e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
                              : e.target.value.replace(/[^\d-]/g, '')
                          )
                        }
                        inputMode={captcha.mode === 'image' ? 'text' : 'numeric'}
                        autoComplete="off"
                        dir="ltr"
                        placeholder={captcha.mode === 'image' ? '4K9R2' : '6824'}
                        maxLength={captcha.mode === 'image' ? 6 : 10}
                      />
                      {/* Le défi est porté par le SVG : role="img" + libellé = la question elle-même,
                          sinon il serait invisible aux lecteurs d'écran (l'audio seul ne suffit pas). */}
                      <div className="captcha-box" role="img" aria-label={captcha.question || t('captcha.question')} dangerouslySetInnerHTML={{ __html: captcha.svg }} />
                      <div className="captcha-actions">
                        <button type="button" className="btn btn-ghost" onClick={loadCaptcha} title={t('captcha.refresh')} aria-label={t('captcha.refresh')}>
                          <Loader2 size={14} />
                        </button>
                        <button type="button" className="btn btn-ghost" title={t('captcha.audio')} aria-label={t('captcha.audio')} onClick={speakQuestion}>
                          <Volume2 size={14} />
                        </button>
                      </div>
                    </div>
                  </Field>
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

            <Button
              type="submit"
              variant="primary"
              loading={busy}
              className="mt-1 w-full"
              disabled={!needTotp && (!identifier || !password || (captchaNeedsToken((captcha?.provider ?? 'none') as CaptchaProviderName) && !captchaToken && !captchaBlocked))}
            >
              <KeyRound size={16} /> {needTotp ? t('login.verify') : t('login.submit')}
            </Button>
            {/* Liens secondaires — rangée unique, centrée, style homogène (mot de passe oublié,
                retour à la connexion en mode 2FA) : auparavant ils n'avaient ni le même style ni
                le même alignement selon le mode affiché. */}
            <div className="form-links">
              {needTotp ? (
                <button type="button" onClick={() => window.location.replace('/login')}>
                  {t('auth.backToLogin')}
                </button>
              ) : null}
              <Link href="/forgot">{t('forgot.link')}</Link>
            </div>
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
