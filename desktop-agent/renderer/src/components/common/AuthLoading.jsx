import React from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import tallyfinLogo from '../../assets/tallyfin-icon.png'

const AuthLoading = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 relative overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-br from-primary-900/40 via-slate-950 to-indigo-950" />
    <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-500/20 rounded-full blur-3xl" />
    <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-indigo-500/15 rounded-full blur-3xl" />

    <div className="relative z-10 flex flex-col items-center gap-6">
      <img
        src={tallyfinLogo}
        alt="TallyFin"
        className="w-16 h-16 rounded-2xl bg-white object-contain p-1 shadow-2xl shadow-primary-500/40 ring-2 ring-white/10"
      />
      <div className="text-center">
        <p className="text-lg font-semibold text-white">TallyFin Desktop Agent</p>
        <p className="text-sm text-green-300/80 mt-0.5">Har Hisaab Aasan Hai</p>
        <p className="text-sm text-slate-400 mt-2">Checking your session…</p>
      </div>
      <ArrowPathIcon className="w-8 h-8 text-primary-400 animate-spin" />
    </div>
  </div>
)

export default AuthLoading
