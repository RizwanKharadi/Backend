import React, { useEffect } from 'react'
import { Toaster } from 'react-hot-toast'

import Header from './components/layout/Header'
import Sidebar from './components/layout/Sidebar'

import Dashboard from './pages/Dashboard'
import SyncStatus from './pages/SyncStatus'
import TallyConnection from './pages/TallyConnection'
import SystemMonitor from './pages/SystemMonitor'
import Logs from './pages/Logs'
import Settings from './pages/Settings'
import Subscription from './pages/Subscription'
import Login from './pages/Login'
import MyCompanies from './pages/MyCompanies'
import AddCompany from './pages/AddCompany'

import { useElectronAPI } from './hooks/useElectronAPI'
import { useAppStore } from './stores/appStore'
import ErrorBoundary from './components/common/ErrorBoundary'
import AuthLoading from './components/common/AuthLoading'
import SubscriptionBanner from './components/common/SubscriptionBanner'

function App() {
  const { config, appState, setCurrentPage, connectionStatus } = useAppStore()
  const { initializeAPI, serverLogout, refreshSubscriptionAccess } = useElectronAPI()
  const currentPage = appState.currentPage
  const authReady = appState.authReady
  const isAuthenticated = authReady && Boolean(config?.server?.token)

  useEffect(() => {
    initializeAPI()
  }, [initializeAPI])

  useEffect(() => {
    if (!authReady || !isAuthenticated) {
      return undefined
    }
    refreshSubscriptionAccess()
    const interval = setInterval(() => {
      refreshSubscriptionAccess()
    }, 60000)
    return () => clearInterval(interval)
  }, [authReady, isAuthenticated, refreshSubscriptionAccess])

  const handleAuthSuccess = async (isNewUser) => {
    await refreshSubscriptionAccess()
    setCurrentPage(isNewUser ? 'add-company' : 'dashboard')
  }

  const handleLogout = async () => {
    await serverLogout()
  }

  const renderCurrentPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />
      case 'my-companies':
        return <MyCompanies />
      case 'add-company':
        return <AddCompany />
      case 'sync':
        return <SyncStatus />
      case 'tally':
        return <TallyConnection />
      case 'system':
        return <SystemMonitor />
      case 'logs':
        return <Logs />
      case 'settings':
        return <Settings />
      case 'subscription':
        return <Subscription />
      default:
        return <Dashboard />
    }
  }

  if (!authReady) {
    return (
      <ErrorBoundary>
        <AuthLoading />
      </ErrorBoundary>
    )
  }

  if (!isAuthenticated) {
    return (
      <ErrorBoundary>
        <Login onSuccess={handleAuthSuccess} />
        <Toaster position="top-right" />
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-slate-100 overflow-hidden">
        <Header
          connectionStatus={connectionStatus}
          userEmail={config.server?.userEmail}
          onMinimize={() => window.electronAPI?.minimizeToTray()}
          onSettings={() => setCurrentPage('settings')}
          onLogout={handleLogout}
          onSubscription={() => setCurrentPage('subscription')}
        />

        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            currentPage={currentPage}
            onPageChange={setCurrentPage}
          />

          <main className="flex-1 overflow-y-auto bg-gradient-to-br from-slate-50 via-white to-primary-50/30 p-6 scrollbar-thin">
            <div className="max-w-7xl mx-auto animate-fade-in">
              <SubscriptionBanner onGoToSubscription={() => setCurrentPage('subscription')} />
              {renderCurrentPage()}
            </div>
          </main>
        </div>

        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#fff',
              color: '#374151',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
              border: '1px solid #e5e7eb'
            },
            success: {
              iconTheme: { primary: '#10b981', secondary: '#fff' }
            },
            error: {
              iconTheme: { primary: '#ef4444', secondary: '#fff' }
            }
          }}
        />
      </div>
    </ErrorBoundary>
  )
}

export default App
