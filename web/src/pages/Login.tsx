// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useEffect, useState, FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { ZyvorBrandLine } from '../components/ZyvorBrand'
import { beginOidcLogin, getAuthProviders, type AuthProviders } from '../api/auth'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { formatUserError } from '../utils/apiError'
import {
  Lock,
  User,
  ArrowRight,
  Loader2,
  CheckCircle,
  Eye,
  EyeOff,
  Zap,
  Server,
  Network,
  Activity,
  Boxes,
  HardDrive,
} from 'lucide-react'
import {
  PremiumLoginShell,
  LoginDivider,
  LoginError,
  LoginField,
  LoginRemember,
  LoginSubmit,
  type PremiumLoginFeature,
  type PremiumLoginPill,
} from '../components/PremiumLoginShell'

function MachinaLogo() {
  return (
    <div className="w-14 h-14 rounded-[18px] flex items-center justify-center bg-gradient-to-br from-blue-400 via-blue-600 to-indigo-800 border border-white/20 shadow-xl shadow-blue-500/30">
      <Zap className="w-7 h-7 text-white drop-shadow" aria-hidden />
    </div>
  )
}

const MACOS_PILLS: PremiumLoginPill[] = [
  { icon: <Server className="w-3 h-3" aria-hidden />, label: 'Libvirt + KVM' },
  { icon: <HardDrive className="w-3 h-3" aria-hidden />, label: 'OpenStack ready' },
  { label: 'PAM auth' },
]

const MACOS_FEATURES: PremiumLoginFeature[] = [
  {
    icon: <Server className="w-5 h-5 text-blue-100" />,
    gradient: 'from-blue-500/95 to-indigo-800/95',
    glow: 'shadow-blue-500/25',
    title: 'VM lifecycle',
    description: 'Create, start, stop, snapshot, and migrate QEMU/KVM guests with VNC and serial consoles.',
    highlight: true,
  },
  {
    icon: <Network className="w-5 h-5 text-emerald-100" />,
    gradient: 'from-emerald-500/95 to-teal-800/95',
    glow: 'shadow-emerald-500/25',
    title: 'Host networking & storage',
    description: 'Topology maps, port forwards, pools, and firewall rules on the hypervisor node.',
  },
  {
    icon: <Activity className="w-5 h-5 text-purple-100" />,
    gradient: 'from-purple-500/95 to-fuchsia-800/95',
    glow: 'shadow-purple-500/25',
    title: 'Monitoring & automation',
    description: 'Live metrics, alerts, webhooks, schedules, and Prometheus hooks.',
  },
  {
    icon: <Boxes className="w-5 h-5 text-orange-100" />,
    gradient: 'from-orange-500/95 to-rose-700/95',
    glow: 'shadow-orange-500/25',
    title: 'KubeVirt & qcow2',
    description: 'Golden images to Kubernetes — Linux or Windows profiles, CDI upload, virtctl from Disk Images.',
  },
]

export default function LoginPage() {
  const saved = (() => {
    try {
      const raw = localStorage.getItem('machina-saved-login')
      return raw ? (JSON.parse(raw) as { username?: string; password?: string }) : null
    } catch {
      return null
    }
  })()

  const [username, setUsername] = useState(saved?.username ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(!!saved)
  const [providers, setProviders] = useState<AuthProviders>({
    pam: { enabled: true },
    ldap: { enabled: false },
    oidc: { enabled: false, button_label: 'Sign in with SSO' },
    saml: { enabled: false, button_label: 'Sign in with SAML', login_available: false },
  })
  const { t } = useTranslation()
  const { login } = useAuth()
  const reducedMotion = usePrefersReducedMotion()
  const hostLabel = typeof window !== 'undefined' ? window.location.hostname : ''
  const oidcEnabled = providers.oidc.enabled
  const pamEnabled = providers.pam.enabled
  const ldapEnabled = providers.ldap.enabled
  const passwordLogin = pamEnabled || ldapEnabled

  useEffect(() => {
    void getAuthProviders().then(setProviders).catch(() => {})
    const params = new URLSearchParams(window.location.search)
    const errorParam = params.get('error')
    if (errorParam === 'oidc') {
      setError('SSO login failed')
    } else if (errorParam === 'token') {
      setError('Sign-in link is invalid or expired')
    } else if (errorParam === 'saml') {
      setError('SAML authentication failed')
    } else if (errorParam) {
      setError('Authentication failed — please try again')
    }
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Username and password are required')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await login(username.trim(), password)
      if (rememberMe) {
        localStorage.setItem(
          'machina-saved-login',
          JSON.stringify({ username: username.trim() }),
        )
      } else {
        localStorage.removeItem('machina-saved-login')
      }
    } catch (e: unknown) {
      setError(formatUserError(e) || 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  const panelSubtitle = hostLabel
    ? `Sign in to libvirt and automation on ${hostLabel}`
    : 'Sign in to libvirt, OpenStack, and automation on this host'

  return (
    <div className={`relative min-h-screen${reducedMotion ? ' login-page-reduced-motion' : ''}`}>
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-30">
        <LanguageSwitcher />
      </div>

      <PremiumLoginShell
        variant="macos"
        heroWidth="58"
        logo={<MachinaLogo />}
        productName="Machina"
        productSubtitle="Hypervisor control plane"
        heroHeadline={
          <>
            Libvirt + OpenStack
            <br />
            <span className="login-text-gradient">on one hypervisor host</span>
          </>
        }
        heroSubheadline="QEMU/KVM under libvirt, Nova and Glance when wired, consoles, storage, automation, and block upload to Glance — without Horizon."
        pills={MACOS_PILLS}
        features={MACOS_FEATURES}
        heroFooter={<ZyvorBrandLine />}
        mobileSubtitle="Libvirt · OpenStack · KubeVirt"
        panelTitle="Welcome back"
        panelSubtitle={panelSubtitle}
        footer={
          <div className="lg:hidden text-center pb-6">
            <ZyvorBrandLine />
          </div>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (passwordLogin) void handleSubmit(e)
          }}
          autoComplete={passwordLogin ? 'on' : 'off'}
          aria-label={t('login.title')}
        >
          {error ? <LoginError message={error} /> : null}

          {providers.saml?.enabled && !providers.saml.login_available ? (
            <p className="text-xs text-slate-500 mb-4" role="status">
              SAML metadata is configured for IdP federation — browser SAML login coming soon.
            </p>
          ) : null}

          {oidcEnabled ? (
            <button type="button" onClick={() => beginOidcLogin()} className="login-btn-primary group w-full">
              <span className="relative z-10">{providers.oidc.button_label}</span>
              <ArrowRight className="h-4 w-4 relative z-10 group-hover:translate-x-0.5 transition-transform" />
            </button>
          ) : null}

          {oidcEnabled && passwordLogin ? (
            <LoginDivider label="or sign in with password" />
          ) : null}

          {ldapEnabled ? (
            <p className="text-xs text-slate-400 mb-4" role="status">
              {t('login.ldapHint')}
            </p>
          ) : null}

          {passwordLogin ? (
            <>
              <div className="space-y-5">
                <LoginField label={t('login.username')} id="login-username">
                  <User className="login-field-icon" />
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoFocus={!oidcEnabled}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="root"
                    className="login-input"
                  />
                </LoginField>

                <LoginField label="Password" id="login-password">
                  <Lock className="login-field-icon" />
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="login-input pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </LoginField>
              </div>

              <LoginRemember
                checked={rememberMe}
                onChange={(checked) => {
                  setRememberMe(checked)
                  if (!checked) localStorage.removeItem('machina-saved-login')
                }}
              />

              <LoginSubmit
                loading={submitting}
                disabled={!username || !password}
                secondary={oidcEnabled}
                className="w-full mt-4"
              >
                {submitting ? (
                  <>
                    <Loader2 className={`h-4 w-4 relative z-10${reducedMotion ? '' : ' animate-spin'}`} />
                    <span className="relative z-10">Signing in…</span>
                  </>
                ) : (
                  <>
                    <span className="relative z-10">
                      {oidcEnabled ? 'Sign in with password' : 'Sign in to Machina'}
                    </span>
                    {!oidcEnabled ? (
                      <ArrowRight className="h-4 w-4 relative z-10 group-hover:translate-x-0.5 transition-transform" />
                    ) : null}
                  </>
                )}
              </LoginSubmit>
            </>
          ) : null}

          {pamEnabled ? (
            <div className="mt-6 pt-5 border-t border-slate-700/50 flex items-center justify-center gap-2 text-xs text-slate-500">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500/70" aria-hidden />
              <span>Secured with system PAM (same as SSH)</span>
            </div>
          ) : null}
        </form>

        <p className="text-xs text-center mt-4 max-w-sm mx-auto leading-relaxed text-slate-500">
          {oidcEnabled && pamEnabled
            ? 'Use organization SSO or your system account, depending on how this host is configured.'
            : oidcEnabled
              ? 'You will be redirected to your identity provider to complete sign-in.'
              : (
                <>
                  Same credentials as SSH. If you only use SSH keys, run{' '}
                  <code className="text-[11px] px-1 rounded bg-slate-800/80 text-slate-300">passwd</code> on the
                  server first.
                </>
              )}
        </p>
      </PremiumLoginShell>
    </div>
  )
}
