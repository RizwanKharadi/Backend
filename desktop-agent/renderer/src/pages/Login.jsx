import React, { useState, useEffect } from 'react'
import {
  EnvelopeIcon,
  LockClosedIcon,
  UserIcon,
  PhoneIcon,
  CloudArrowUpIcon,
  ShieldCheckIcon,
  DevicePhoneMobileIcon,
  ArrowPathIcon,
  EyeIcon,
  EyeSlashIcon,
  ArrowLeftIcon,
  KeyIcon
} from '@heroicons/react/24/outline'
import { useElectronAPI } from '../hooks/useElectronAPI'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import tallyfinLogo from '../assets/tallyfin-icon.png'

const TAGLINE = 'Har Hisaab Aasan Hai'

const AuthField = ({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  icon: Icon,
  required,
  autoComplete,
  showPasswordToggle = false,
  showPassword = false,
  onTogglePassword
}) => (
  <div className="space-y-1.5">
    <label className="block text-sm font-medium text-slate-700">{label}</label>
    <div className="relative group">
      {Icon && (
        <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-primary-500 transition-colors pointer-events-none" />
      )}
      <input
        type={showPasswordToggle ? (showPassword ? 'text' : 'password') : type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        className={clsx(
          'w-full rounded-xl border border-slate-200 bg-slate-50/80 py-3 text-sm text-slate-900',
          'placeholder:text-slate-400',
          'transition-all duration-200',
          'focus:bg-white focus:border-primary-500 focus:ring-4 focus:ring-primary-500/15 focus:outline-none',
          Icon ? 'pl-11' : 'pl-4',
          showPasswordToggle ? 'pr-11' : 'pr-4'
        )}
      />
      {showPasswordToggle && (
        <button
          type="button"
          onClick={onTogglePassword}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
          tabIndex={-1}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? (
            <EyeSlashIcon className="w-5 h-5" />
          ) : (
            <EyeIcon className="w-5 h-5" />
          )}
        </button>
      )}
    </div>
  </div>
)

const BrandLogo = ({ size = 'md' }) => {
  const sizes = {
    sm: { img: 'w-11 h-11', title: 'font-bold text-slate-900', tag: 'text-xs text-slate-500' },
    md: { img: 'w-12 h-12', title: 'text-lg font-bold text-white', tag: 'text-xs text-green-200 font-medium' }
  }
  const s = sizes[size] || sizes.md

  return (
    <div className="inline-flex items-center gap-3">
      <img
        src={tallyfinLogo}
        alt="TallyFin"
        className={clsx(s.img, 'rounded-2xl bg-white ring-2 ring-white/30 shadow-lg object-contain p-1')}
      />
      <div>
        <p className={clsx(s.title, 'tracking-tight')}>TallyFin</p>
        <p className={s.tag}>{TAGLINE}</p>
      </div>
    </div>
  )
}

const FeatureItem = ({ icon: Icon, title, description }) => (
  <div className="flex gap-3 items-start">
    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20">
      <Icon className="w-5 h-5 text-white" />
    </div>
    <div>
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="text-xs text-blue-100/90 mt-0.5 leading-relaxed">{description}</p>
    </div>
  </div>
)

const Login = ({ onSuccess }) => {
  const {
    serverLogin,
    serverRegister,
    serverForgotPassword,
    serverResetPassword,
    serverVerifyOtp,
    serverResendOtp
  } = useElectronAPI()
  const [mode, setMode] = useState('login')
  const [status, setStatus] = useState('idle')
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [showSignupPassword, setShowSignupPassword] = useState(false)
  const [showSignupConfirm, setShowSignupConfirm] = useState(false)
  const [showResetPassword, setShowResetPassword] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [signupForm, setSignupForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: ''
  })
  const [forgotForm, setForgotForm] = useState({ email: '' })
  // Which flow the code belongs to, and who it went to.
  const [otpContext, setOtpContext] = useState({ email: '', purpose: 'email_verification' })
  const [otpCode, setOtpCode] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const [resetForm, setResetForm] = useState({ token: '', password: '', confirmPassword: '' })

  const isLoading = status === 'loading'

  const handleLogin = async (e, forceLogin = false) => {
    e?.preventDefault?.()
    if (!loginForm.email || !loginForm.password) {
      toast.error('Enter email and password')
      return
    }
    setStatus('loading')
    try {
      const result = await serverLogin({ ...loginForm, forceLogin })
      // One device at a time. The password is already proven correct at this
      // point, so offer to sign the other device out rather than dead-ending.
      if (result?.sessionActiveElsewhere) {
        const d = result.activeDevice
        const label = d?.deviceName ? `"${d.deviceName}"` : 'another device'
        if (window.confirm(
          `This account is signed in on ${label}.

` +
          'TallyFin allows one device at a time. Sign that device out and continue here?'
        )) {
          setStatus('idle')
          return handleLogin(e, true)
        }
        return
      }
      if (result?.requiresVerification) {
        // Password was right; the address just isn't verified yet.
        setOtpContext({ email: result.email || loginForm.email, purpose: 'email_verification' })
        setOtpCode('')
        setResendIn(60)
        setMode('otp')
        toast(result.message || 'Please verify your email.')
      } else if (result?.success) {
        onSuccess?.(false)
      }
    } finally {
      setStatus('idle')
      setLoginForm((prev) => ({ ...prev, password: '' }))
    }
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    if (!signupForm.name || !signupForm.email || !signupForm.phone || !signupForm.password) {
      toast.error('Fill in all required fields')
      return
    }
    if (signupForm.password !== signupForm.confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (signupForm.password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    setStatus('loading')
    try {
      let tallyLicense = null
      try {
        if (window.electronAPI?.tallyGetLicenseInfo) {
          tallyLicense = await window.electronAPI.tallyGetLicenseInfo()
        }
      } catch {
        // Tally may not be running during signup — registration still proceeds
      }

      const result = await serverRegister({
        name: signupForm.name,
        email: signupForm.email,
        phone: signupForm.phone,
        password: signupForm.password,
        tallyLicense: tallyLicense || undefined
      })
      if (result?.requiresVerification) {
        // No session yet — the account is unusable until the emailed code is
        // confirmed, so move to the OTP step rather than the dashboard.
        setOtpContext({ email: result.email || signupForm.email, purpose: 'email_verification' })
        setOtpCode('')
        setResendIn(60)
        setMode('otp')
        toast.success(result.message || 'Enter the code we emailed you.')
      } else if (result?.success) {
        toast.success('Welcome! Link your Tally company next.')
        onSuccess?.(true)
      }
    } finally {
      setStatus('idle')
      setSignupForm((prev) => ({ ...prev, password: '', confirmPassword: '' }))
    }
  }

  const handleForgotPassword = async (e) => {
    e.preventDefault()
    if (!forgotForm.email) {
      toast.error('Enter your email address')
      return
    }
    setStatus('loading')
    try {
      const result = await serverForgotPassword(forgotForm.email)
      if (result?.success) {
        // Always advance, whether or not the address has an account — telling
        // the caller otherwise would leak who is a customer.
        setOtpContext({ email: forgotForm.email, purpose: 'password_reset' })
        setOtpCode('')
        setResendIn(60)
        setMode('otp')
      }
    } finally {
      setStatus('idle')
    }
  }


  // Resend cooldown mirrors the server's; the server is still the authority.
  useEffect(() => {
    if (resendIn <= 0) return undefined
    const timer = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(timer)
  }, [resendIn])

  const handleVerifyOtp = async (e) => {
    e?.preventDefault?.()
    if (otpCode.length !== 6) {
      toast.error('Enter the 6-digit code')
      return
    }
    setStatus('loading')
    try {
      const result = await serverVerifyOtp(otpContext.email, otpCode, otpContext.purpose)
      if (!result?.success) return

      if (otpContext.purpose === 'password_reset') {
        // The code is spent; the ticket authorises exactly one password change.
        setResetForm({ token: result.resetTicket || '', password: '', confirmPassword: '' })
        setMode('reset')
        toast.success('Code verified. Choose a new password.')
      } else {
        toast.success('Email verified. Link your Tally company next.')
        onSuccess?.(true)
      }
    } finally {
      setStatus('idle')
      setOtpCode('')
    }
  }

  const handleResendOtp = async () => {
    if (resendIn > 0) return
    setStatus('loading')
    try {
      await serverResendOtp(otpContext.email, otpContext.purpose)
      setResendIn(60)
      setOtpCode('')
    } finally {
      setStatus('idle')
    }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    if (!resetForm.token || !resetForm.password) {
      toast.error('Enter reset code and new password')
      return
    }
    if (resetForm.password !== resetForm.confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (resetForm.password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    setStatus('loading')
    try {
      // resetForm.token holds the one-shot ticket from verifying the OTP.
      const result = await serverResetPassword(resetForm.token, resetForm.password)
      if (result?.success) {
        toast.success('Password updated. Sign in with your new password.')
        setLoginForm({ email: forgotForm.email || '', password: '' })
        setMode('login')
        setResetForm({ token: '', password: '', confirmPassword: '' })
      }
    } finally {
      setStatus('idle')
      setResetForm((prev) => ({ ...prev, password: '', confirmPassword: '' }))
    }
  }

  const modeTitle = {
    login: 'Welcome back',
    signup: 'Create account',
    forgot: 'Forgot password',
    otp: 'Verify your email',
    reset: 'Reset password'
  }

  const modeSubtitle = {
    login: 'Sign in to continue syncing your Tally data',
    signup: 'Register to start linking Tally companies',
    forgot: 'Enter your email to receive a password reset code',
    otp: 'Enter the 6-digit code we emailed you',
    reset: 'Choose a new password'
  }

  return (
    <div className="min-h-screen flex bg-slate-950">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-[44%] xl:w-[48%] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-navy-700 via-navy-600 to-primary-700" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`,
            backgroundSize: '28px 28px'
          }}
        />
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 w-96 h-96 rounded-full bg-indigo-400/20 blur-3xl" />

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-14 w-full">
          <div>
            <div className="mb-10">
              <BrandLogo size="md" />
            </div>

            <h2 className="text-3xl xl:text-4xl font-bold text-white leading-tight tracking-tight">
              Access Tally Data
              <span className="block text-blue-200">from anywhere anytime</span>
            </h2>
            <p className="mt-4 text-sm text-blue-100/90 max-w-sm leading-relaxed">
              Connect your Tally books, sync vouchers and masters, and view everything on mobile — securely linked to your account.
            </p>
          </div>

          <div className="space-y-5">
            <FeatureItem
              icon={CloudArrowUpIcon}
              title="Real-time tally sync"
              description="Vouchers, parties, items and reports flow seamlessly."
            />
            <FeatureItem
              icon={DevicePhoneMobileIcon}
              title="Same account as mobile"
              description="Sign in once — your data follows you on every device."
            />
            <FeatureItem
              icon={ShieldCheckIcon}
              title="Secure by design"
              description="Encrypted credentials and JWT-protected API access."
            />
          </div>

          <p className="text-xs text-blue-200/60">© TallyFin · Tally ERP Integration</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 bg-gradient-to-br from-slate-50 via-white to-primary-50/40 overflow-y-auto">
        <div className="w-full max-w-[420px] animate-fade-in">
          <div className="lg:hidden flex justify-center mb-8">
            <BrandLogo size="sm" />
          </div>

          <div className="bg-white rounded-2xl shadow-strong border border-slate-100/80 overflow-hidden">
            <div className="px-8 pt-8 pb-2">
              {mode !== 'login' && mode !== 'signup' && (
                <button
                  type="button"
                  onClick={() => {
                    // A verified reset ticket is single-use, so stepping back from
                    // the password form means starting the whole flow again.
                    setOtpCode('')
                    setResetForm({ token: '', password: '', confirmPassword: '' })
                    setMode('login')
                  }}
                  className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-primary-600 mb-3 transition-colors"
                >
                  <ArrowLeftIcon className="w-4 h-4" />
                  Back
                </button>
              )}
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                {modeTitle[mode]}
              </h1>
              <p className="text-sm text-slate-500 mt-1">{modeSubtitle[mode]}</p>
            </div>

            {mode === 'login' || mode === 'signup' ? (
              <div className="px-8 pt-4">
                <div className="flex p-1 bg-slate-100 rounded-xl">
                  {['login', 'signup'].map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setMode(tab)}
                      className={clsx(
                        'flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200',
                        mode === tab
                          ? 'bg-white text-primary-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      )}
                    >
                      {tab === 'login' ? 'Sign in' : 'Sign up'}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="p-8 pt-6">
              {mode === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-5">
                  <AuthField
                    label="Email address"
                    type="email"
                    icon={EnvelopeIcon}
                    value={loginForm.email}
                    onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                    placeholder="you@company.com"
                    autoComplete="email"
                    required
                  />
                  <AuthField
                    label="Password"
                    icon={LockClosedIcon}
                    value={loginForm.password}
                    onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                    showPasswordToggle
                    showPassword={showLoginPassword}
                    onTogglePassword={() => setShowLoginPassword((v) => !v)}
                  />

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setForgotForm({ email: loginForm.email })
                        setMode('forgot')
                      }}
                      className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                    >
                      Forgot password?
                    </button>
                  </div>

                  <div className="flex items-start gap-2 rounded-xl bg-primary-50 border border-primary-100 px-4 py-3">
                    <ArrowPathIcon className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-primary-800 leading-relaxed">
                      Use the same email and password as your TallyFin mobile app.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className={clsx(
                      'w-full py-3.5 rounded-xl text-sm font-semibold text-white',
                      'bg-gradient-to-r from-primary-600 to-indigo-600',
                      'shadow-lg shadow-primary-500/30',
                      'hover:from-primary-700 hover:to-indigo-700',
                      'focus:outline-none focus:ring-4 focus:ring-primary-500/30',
                      'transition-all duration-200',
                      'disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none'
                    )}
                  >
                    {isLoading ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Signing in…
                      </span>
                    ) : (
                      'Sign in'
                    )}
                  </button>
                </form>
              ) : mode === 'signup' ? (
                <form onSubmit={handleSignup} className="space-y-4">
                  <AuthField
                    label="Full name"
                    icon={UserIcon}
                    value={signupForm.name}
                    onChange={(e) => setSignupForm({ ...signupForm, name: e.target.value })}
                    placeholder="Your name"
                    autoComplete="name"
                    required
                  />
                  <AuthField
                    label="Email address"
                    type="email"
                    icon={EnvelopeIcon}
                    value={signupForm.email}
                    onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })}
                    placeholder="you@company.com"
                    autoComplete="email"
                    required
                  />
                  <AuthField
                    label="Phone"
                    type="tel"
                    icon={PhoneIcon}
                    value={signupForm.phone}
                    onChange={(e) => setSignupForm({ ...signupForm, phone: e.target.value })}
                    placeholder="+91 98765 43210"
                    autoComplete="tel"
                    required
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <AuthField
                      label="Password"
                      icon={LockClosedIcon}
                      value={signupForm.password}
                      onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })}
                      placeholder="Min. 6 characters"
                      autoComplete="new-password"
                      required
                      showPasswordToggle
                      showPassword={showSignupPassword}
                      onTogglePassword={() => setShowSignupPassword((v) => !v)}
                    />
                    <AuthField
                      label="Confirm"
                      icon={LockClosedIcon}
                      value={signupForm.confirmPassword}
                      onChange={(e) => setSignupForm({ ...signupForm, confirmPassword: e.target.value })}
                      placeholder="Repeat password"
                      autoComplete="new-password"
                      required
                      showPasswordToggle
                      showPassword={showSignupConfirm}
                      onTogglePassword={() => setShowSignupConfirm((v) => !v)}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className={clsx(
                      'w-full py-3.5 rounded-xl text-sm font-semibold text-white mt-2',
                      'bg-gradient-to-r from-primary-600 to-indigo-600',
                      'shadow-lg shadow-primary-500/30',
                      'hover:from-primary-700 hover:to-indigo-700',
                      'focus:outline-none focus:ring-4 focus:ring-primary-500/30',
                      'transition-all duration-200',
                      'disabled:opacity-60 disabled:cursor-not-allowed'
                    )}
                  >
                    {isLoading ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Creating account…
                      </span>
                    ) : (
                      'Create account'
                    )}
                  </button>
                </form>
              ) : mode === 'forgot' ? (
                <form onSubmit={handleForgotPassword} className="space-y-5">
                  <AuthField
                    label="Email address"
                    type="email"
                    icon={EnvelopeIcon}
                    value={forgotForm.email}
                    onChange={(e) => setForgotForm({ email: e.target.value })}
                    placeholder="you@company.com"
                    autoComplete="email"
                    required
                  />
                  <p className="text-xs text-slate-500 leading-relaxed">
                    We&apos;ll email a 6-digit code. Enter it on the next screen to set a new
                    password.
                  </p>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className={clsx(
                      'w-full py-3.5 rounded-xl text-sm font-semibold text-white',
                      'bg-gradient-to-r from-primary-600 to-indigo-600',
                      'shadow-lg shadow-primary-500/30',
                      'hover:from-primary-700 hover:to-indigo-700',
                      'disabled:opacity-60 disabled:cursor-not-allowed'
                    )}
                  >
                    {isLoading ? 'Sending…' : 'Send reset code'}
                  </button>
                </form>
              ) : mode === 'otp' ? (
                <form onSubmit={handleVerifyOtp} className="space-y-5">
                  <div className="rounded-xl bg-primary-50 border border-primary-100 px-4 py-3">
                    <p className="text-xs text-slate-600 leading-relaxed">
                      We sent a 6-digit code to{' '}
                      <span className="font-semibold text-slate-900">{otpContext.email}</span>. It
                      expires in 10 minutes.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-700">
                      Verification code
                    </label>
                    <input
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      placeholder="000000"
                      className={clsx(
                        'w-full rounded-xl border border-slate-200 bg-slate-50/80 py-3.5 px-4',
                        'text-center text-2xl font-semibold tracking-[0.5em] text-slate-900',
                        'placeholder:text-slate-300 placeholder:tracking-[0.5em]',
                        'transition-all duration-200',
                        'focus:bg-white focus:border-primary-500 focus:ring-4 focus:ring-primary-500/15 focus:outline-none'
                      )}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || otpCode.length !== 6}
                    className={clsx(
                      'w-full py-3.5 rounded-xl text-sm font-semibold text-white',
                      'bg-gradient-to-r from-primary-600 to-indigo-600',
                      'shadow-lg shadow-primary-500/30',
                      'hover:from-primary-700 hover:to-indigo-700',
                      'disabled:opacity-60 disabled:cursor-not-allowed'
                    )}
                  >
                    {isLoading ? 'Verifying…' : 'Verify'}
                  </button>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={resendIn > 0 || isLoading}
                      className="text-sm font-medium text-primary-600 hover:text-primary-700 disabled:text-slate-400 disabled:cursor-not-allowed"
                    >
                      {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleResetPassword} className="space-y-4">
                  {!resetForm.token && (
                    <AuthField
                      label="Reset code"
                      icon={KeyIcon}
                      value={resetForm.token}
                      onChange={(e) => setResetForm({ ...resetForm, token: e.target.value })}
                      placeholder="Paste reset code"
                      required
                    />
                  )}
                  <AuthField
                    label="New password"
                    icon={LockClosedIcon}
                    value={resetForm.password}
                    onChange={(e) => setResetForm({ ...resetForm, password: e.target.value })}
                    placeholder="Min. 6 characters"
                    autoComplete="new-password"
                    required
                    showPasswordToggle
                    showPassword={showResetPassword}
                    onTogglePassword={() => setShowResetPassword((v) => !v)}
                  />
                  <AuthField
                    label="Confirm new password"
                    icon={LockClosedIcon}
                    value={resetForm.confirmPassword}
                    onChange={(e) => setResetForm({ ...resetForm, confirmPassword: e.target.value })}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                    required
                    showPasswordToggle
                    showPassword={showResetConfirm}
                    onTogglePassword={() => setShowResetConfirm((v) => !v)}
                  />
                  <button
                    type="submit"
                    disabled={isLoading}
                    className={clsx(
                      'w-full py-3.5 rounded-xl text-sm font-semibold text-white mt-2',
                      'bg-gradient-to-r from-primary-600 to-indigo-600',
                      'shadow-lg shadow-primary-500/30',
                      'hover:from-primary-700 hover:to-indigo-700',
                      'disabled:opacity-60 disabled:cursor-not-allowed'
                    )}
                  >
                    {isLoading ? 'Updating…' : 'Update password'}
                  </button>
                </form>
              )}
            </div>
          </div>

          <p className="text-center text-xs text-slate-400 mt-6">
            By continuing, you agree to sync data only for companies you explicitly add.
          </p>
        </div>
      </div>
    </div>
  )
}

export default Login
