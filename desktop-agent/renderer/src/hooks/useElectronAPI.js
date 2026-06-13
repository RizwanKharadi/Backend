import { useCallback, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { ConnectionStatus, SyncStatus } from '../types'
import toast from 'react-hot-toast'

const resolveApiUrl = (serverConfig = {}) => {
  let apiUrl = serverConfig.apiUrl
  if (!apiUrl && serverConfig.url) {
    try {
      const parsed = new URL(serverConfig.url)
      const protocol = parsed.protocol === 'wss:' ? 'https:' : parsed.protocol === 'ws:' ? 'http:' : parsed.protocol
      apiUrl = `${protocol}//${parsed.host}/api`
    } catch {
      apiUrl = null
    }
  }
  return apiUrl ? apiUrl.replace(/\/+$/, '') : null
}

export const useElectronAPI = () => {
  const {
    setConnectionStatus,
    setSyncStatus,
    setSystemPerformance,
    setConfig,
    addLog,
    setTallyCompanies,
    setAgentInfo,
    addSyncHistory,
    addNotification,
    setCurrentPage,
    setAuthReady,
    setSubscriptionAccess,
    subscriptionAccess,
    config
  } = useAppStore()

  // Check if Electron API is available
  const isElectronAvailable = typeof window !== 'undefined' && window.electronAPI

  // Set up event listeners for Electron events
  const setupEventListeners = useCallback(() => {
    if (!isElectronAvailable) return

    // Sync status updates
    const unsubscribeSyncStatus = window.electronAPI.onSyncStatusUpdate((data) => {
      const normalizedStatus = { ...data }

      // Main process sends progressPercent (0–100) for phase-weighted sync; prefer that.
      if (typeof data?.progressPercent === 'number') {
        normalizedStatus.progress = Math.min(100, Math.max(0, Math.round(data.progressPercent)))
      }

      // Legacy: { processed, total } row counts
      if (typeof data?.processed === 'number') {
        normalizedStatus.processedItems = data.processed
      }
      if (typeof data?.total === 'number') {
        normalizedStatus.totalItems = data.total
      }
      if (typeof normalizedStatus.processedItems === 'number' && typeof normalizedStatus.totalItems === 'number') {
        if (typeof data?.progressPercent !== 'number') {
          normalizedStatus.progress = normalizedStatus.totalItems > 0
            ? Math.min(
                100,
                Math.round((normalizedStatus.processedItems / normalizedStatus.totalItems) * 100)
              )
            : 0
        }
      }

      // Voucher-window detail and ETA belong to the vouchers phase only — clear them
      // when the sync moves to another phase or ends (store merges partial updates).
      const leavingVoucherPhase = data?.phaseKey && data.phaseKey !== 'vouchers'
      const terminal = data?.status === SyncStatus.COMPLETED || data?.status === SyncStatus.FAILED
      if (leavingVoucherPhase || terminal) {
        if (data?.voucherWindow === undefined) normalizedStatus.voucherWindow = null
        if (typeof data?.etaMinutesRemaining !== 'number') normalizedStatus.etaMinutesRemaining = null
      }

      if (data?.status === SyncStatus.COMPLETED) {
        normalizedStatus.progress = 100
        normalizedStatus.phaseKey = null
        normalizedStatus.currentStage = null
        normalizedStatus.phaseIndex = null
      }
      if (data?.status === SyncStatus.FAILED) {
        normalizedStatus.progress = normalizedStatus.progress || 0
      }

      setSyncStatus(normalizedStatus)
      
      if (data.status === SyncStatus.COMPLETED) {
        addSyncHistory(normalizedStatus)
      }
    })

    // Tally connection updates
    const unsubscribeTallyConnection = window.electronAPI.onTallyConnectionUpdate((data) => {
      setConnectionStatus('tally', data.isConnected ? ConnectionStatus.CONNECTED : ConnectionStatus.DISCONNECTED)
      
      if (data.companies) {
        setTallyCompanies(data.companies)
      }
    })

    // WebSocket connection updates
    const unsubscribeWebSocket = window.electronAPI.onWebSocketUpdate((data) => {
      setConnectionStatus(
        'server',
        data.isConnected ? ConnectionStatus.CONNECTED : ConnectionStatus.DISCONNECTED,
        { lastError: data.lastError || null }
      )
    })

    // Notification events
    const unsubscribeNotifications = window.electronAPI.onShowNotification((data) => {
      addNotification({
        type: data.type || 'info',
        title: data.title,
        message: data.body || data.message
      })
      
      // Also show toast notification
      toast(data.body || data.message, {
        icon: data.type === 'error' ? '❌' : data.type === 'success' ? '✅' : 'ℹ️'
      })
    })

    // Settings events
    const unsubscribeSettings = window.electronAPI.onShowSettings(() => {
      setCurrentPage('settings')
    })

    // Cleanup function
    return () => {
      unsubscribeSyncStatus?.()
      unsubscribeTallyConnection?.()
      unsubscribeWebSocket?.()
      unsubscribeNotifications?.()
      unsubscribeSettings?.()
    }
  }, [isElectronAvailable, setSyncStatus, setConnectionStatus, setTallyCompanies, addNotification, addSyncHistory, setCurrentPage])

  const refreshSubscriptionAccess = useCallback(async () => {
    if (!isElectronAvailable || typeof window.electronAPI.billingGetStatus !== 'function') {
      return null
    }
    try {
      const data = await window.electronAPI.billingGetStatus()
      const access = data?.access || { allowed: true }
      setSubscriptionAccess({
        ...access,
        displayMessage: data?.displayMessage || null
      })
      return data
    } catch (error) {
      if (error?.message?.includes('Log in')) {
        setSubscriptionAccess({ allowed: false, status: 'logged_out', reason: error.message })
      }
      return null
    }
  }, [isElectronAvailable, setSubscriptionAccess])

  // Initialize API and set up event listeners
  const initializeAPI = useCallback(async () => {
    if (!isElectronAvailable) {
      console.warn('Electron API not available - running in browser mode')
      setAuthReady(true)
      return
    }

    try {
      // Load initial configuration
      let config = await window.electronAPI.getConfig()
      if (config) {
        if (config.server?.token && typeof window.electronAPI.validateSession === 'function') {
          const validation = await window.electronAPI.validateSession()
          if (!validation?.valid) {
            config = await window.electronAPI.getConfig()
            if (!config?.server?.token) {
              toast.error('Please sign in again to continue.', { duration: 8000 })
            }
          }
        }
        setConfig(config || await window.electronAPI.getConfig())
        const latest = await window.electronAPI.getConfig()
        if (latest?.server?.token) {
          const hydrateFn = window.electronAPI.hydrateLinkedCompanies
          if (typeof hydrateFn === 'function') {
            const hydrated = await hydrateFn()
            if (hydrated?.success) {
              const refreshed = await window.electronAPI.getConfig()
              if (refreshed) {
                setConfig(refreshed)
              }
            }
          }
        }
      }

      // Load initial system info
      const systemInfo = await window.electronAPI.getSystemInfo()
      if (systemInfo) {
        setAgentInfo({
          version: systemInfo.versions?.app || '1.0.0',
          agentId: config?.agent?.id || '',
          platform: systemInfo.platform,
          arch: systemInfo.arch
        })
      }

      // Set up event listeners
      setupEventListeners()

      const liveSync = await window.electronAPI.syncStatus()
      if (liveSync?.isSyncing) {
        setSyncStatus({ status: SyncStatus.RUNNING, currentOperation: 'Synchronization in progress…' })
      } else if (liveSync?.lastSync?.status === 'completed') {
        setSyncStatus({
          status: SyncStatus.COMPLETED,
          progress: 100,
          processedItems: liveSync.lastSync.processedItems ?? 0,
          totalItems: liveSync.lastSync.totalItems ?? 0,
          lastSync: liveSync.lastSync.endTime,
          currentOperation: 'Sync finished',
          queuePending: liveSync.offlineQueueSize ?? 0
        })
      }

      // Hydrate current connection state so UI is accurate even if startup events were missed.
      const connectionState = await window.electronAPI.getConnectionState()
      if (connectionState?.server) {
        setConnectionStatus(
          'server',
          connectionState.server.isConnected ? ConnectionStatus.CONNECTED : ConnectionStatus.DISCONNECTED,
          { lastError: connectionState.server.lastError || null }
        )
      }

      const activeConfig = await window.electronAPI.getConfig()
      if (activeConfig?.server?.token) {
        await refreshSubscriptionAccess()
      }
      if (connectionState?.tally) {
        setConnectionStatus(
          'tally',
          connectionState.tally.isConnected ? ConnectionStatus.CONNECTED : ConnectionStatus.DISCONNECTED
        )
      }

      console.log('Electron API initialized successfully')
    } catch (error) {
      console.error('Failed to initialize Electron API:', error)
      addLog({
        level: 'error',
        message: `Failed to initialize Electron API: ${error.message}`
      })
    } finally {
      setAuthReady(true)
    }
  }, [
    isElectronAvailable,
    setConfig,
    setAgentInfo,
    addLog,
    setupEventListeners,
    setConnectionStatus,
    setAuthReady,
    refreshSubscriptionAccess
  ])

  // Configuration methods
  const getConfig = useCallback(async () => {
    if (!isElectronAvailable) return null
    try {
      return await window.electronAPI.getConfig()
    } catch (error) {
      console.error('Failed to get config:', error)
      return null
    }
  }, [isElectronAvailable])

  const setConfigValue = useCallback(async (config) => {
    if (!isElectronAvailable) return false
    try {
      await window.electronAPI.setConfig(config)
      const latest = await window.electronAPI.getConfig()
      if (latest) {
        setConfig(latest)
      }
      return true
    } catch (error) {
      console.error('Failed to set config:', error)
      toast.error('Failed to save configuration')
      return false
    }
  }, [isElectronAvailable, setConfig])

  const serverLogin = useCallback(async (credentials) => {
    if (!isElectronAvailable) return { success: false }
    try {
      const result = await window.electronAPI.serverLogin(credentials)
      if (result?.success) {
        toast.success('Logged in successfully')
        const updatedConfig = await window.electronAPI.getConfig()
        if (updatedConfig) {
          setConfig(updatedConfig)
        }
      }
      return result
    } catch (error) {
      console.error('Server login failed:', error)
      toast.error(`Login failed: ${error.message}`)
      return { success: false, error: error.message }
    }
  }, [isElectronAvailable, setConfig])

  const serverRegister = useCallback(async (payload) => {
    if (!isElectronAvailable) return { success: false }
    try {
      const result = await window.electronAPI.serverRegister(payload)
      if (result?.success) {
        const updatedConfig = await window.electronAPI.getConfig()
        if (updatedConfig) {
          setConfig(updatedConfig)
        }
      }
      return result
    } catch (error) {
      console.error('Server register failed:', error)
      toast.error(error.message || 'Registration failed')
      return { success: false, error: error.message }
    }
  }, [isElectronAvailable, setConfig])

  const serverForgotPassword = useCallback(async (email) => {
    if (!isElectronAvailable) return { success: false }
    try {
      const result = await window.electronAPI.serverForgotPassword(email)
      if (result?.success) {
        toast.success(result.message || 'Reset code sent')
      }
      return result
    } catch (error) {
      console.error('Forgot password failed:', error)
      toast.error(error.message || 'Could not request password reset')
      return { success: false, error: error.message }
    }
  }, [isElectronAvailable])

  const serverResetPassword = useCallback(async (token, password) => {
    if (!isElectronAvailable) return { success: false }
    try {
      const result = await window.electronAPI.serverResetPassword({ token, password })
      if (result?.success) {
        toast.success(result.message || 'Password updated')
      }
      return result
    } catch (error) {
      console.error('Reset password failed:', error)
      toast.error(error.message || 'Could not reset password')
      return { success: false, error: error.message }
    }
  }, [isElectronAvailable])

  const unlinkTallyCompany = useCallback(async (entry) => {
    if (!isElectronAvailable) return { success: false }
    try {
      const result = await window.electronAPI.unlinkTallyCompany(entry)
      if (result?.success) {
        const updatedConfig = await window.electronAPI.getConfig()
        if (updatedConfig) {
          setConfig(updatedConfig)
        }
      }
      return result
    } catch (error) {
      console.error('Unlink company failed:', error)
      toast.error(error.message || 'Failed to remove company')
      return { success: false, error: error.message }
    }
  }, [isElectronAvailable, setConfig])

  const linkTallyCompanyViaHttp = useCallback(async (tallyCompany, currentConfig) => {
    const apiUrl = resolveApiUrl(currentConfig?.server)
    const token = currentConfig?.server?.token
    if (!apiUrl) {
      throw new Error('Server API URL is not configured.')
    }
    if (!token) {
      throw new Error('Log in first to link a Tally company.')
    }

    const response = await fetch(`${apiUrl}/companies/link-tally`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        name: tallyCompany.name,
        guid: tallyCompany.guid,
        booksFrom: tallyCompany.booksFrom,
        startingFrom: tallyCompany.startingFrom,
        tallyLicense: tallyCompany.tallyLicense
      })
    })

    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(body.message || `Failed to link company (${response.status})`)
    }

    const company = body?.data?.company
    const cloudCompanyId = String(company?._id || company?.id || '')
    if (!cloudCompanyId) {
      throw new Error('Company was linked but no ID was returned.')
    }

    const tallyKey = String(tallyCompany.guid || tallyCompany.name).trim()
    const linkedCompanies = Array.isArray(currentConfig.server?.linkedCompanies)
      ? [...currentConfig.server.linkedCompanies]
      : []
    const entry = {
      tallyGuid: tallyKey,
      tallyName: tallyCompany.name,
      cloudCompanyId,
      linkedAt: new Date().toISOString()
    }
    const existingIndex = linkedCompanies.findIndex(
      (item) => item.tallyGuid === tallyKey || item.tallyName === tallyCompany.name
    )
    if (existingIndex >= 0) {
      linkedCompanies[existingIndex] = entry
    } else {
      linkedCompanies.push(entry)
    }

    const newConfig = {
      ...currentConfig,
      server: {
        ...currentConfig.server,
        companyId: cloudCompanyId,
        linkedCompanies
      },
      tally: {
        ...currentConfig.tally,
        selectedCompanies: [tallyKey]
      }
    }

    await window.electronAPI.setConfig(newConfig)
    return { success: true, cloudCompanyId, company, linkedCompanies }
  }, [])

  const linkTallyCompany = useCallback(async (tallyCompany) => {
    if (!isElectronAvailable) return { success: false }
    try {
      let result
      if (typeof window.electronAPI.linkTallyCompany === 'function') {
        result = await window.electronAPI.linkTallyCompany(tallyCompany)
      } else if (typeof window.electronAPI.invoke === 'function') {
        result = await window.electronAPI.invoke('link-tally-company', tallyCompany)
      } else {
        const latestConfig = (await window.electronAPI.getConfig()) || config
        result = await linkTallyCompanyViaHttp(tallyCompany, latestConfig)
      }

      if (result?.success) {
        const updatedConfig = await window.electronAPI.getConfig()
        if (updatedConfig) {
          setConfig(updatedConfig)
        }
        toast.success(`Linked "${tallyCompany.name}"`)
      }
      return result
    } catch (error) {
      console.error('Link Tally company failed:', error)
      const message = error.message || 'Failed to link company'
      if (message.includes('is not a function')) {
        toast.error('Please fully quit and restart the Desktop Agent, then try again.')
      } else {
        toast.error(message)
      }
      return { success: false, error: message }
    }
  }, [isElectronAvailable, setConfig, config, linkTallyCompanyViaHttp])

  const serverLogout = useCallback(async () => {
    if (!isElectronAvailable) return { success: false }
    try {
      const result = await window.electronAPI.serverLogout()
      if (result?.success) {
        toast.success('Logged out successfully')
        const updatedConfig = await window.electronAPI.getConfig()
        if (updatedConfig) {
          setConfig(updatedConfig)
        }
      }
      return result
    } catch (error) {
      console.error('Server logout failed:', error)
      toast.error(`Logout failed: ${error.message}`)
      return { success: false, error: error.message }
    }
  }, [isElectronAvailable, setConfig])

  // Tally methods
  const testTallyConnection = useCallback(async () => {
    if (!isElectronAvailable) return false
    try {
      const result = await window.electronAPI.tallyTestConnection()
      const ok = result === true || result?.success === true
      if (ok) {
        toast.success('Tally connection successful')
        if (result?.serialCheck?.inUse) {
          toast.error(
            `Tally serial already registered with ${result.serialCheck.registeredEmail || 'another account'}`,
            { duration: 8000 }
          )
        }
        setConnectionStatus('tally', ConnectionStatus.CONNECTED)
        try {
          const companies = await window.electronAPI.tallyGetCompanies()
          setTallyCompanies(companies || [])
          if ((companies || []).length) {
            toast.success(`Loaded ${companies.length} Tally workspace(s)`)
          }
        } catch (fetchErr) {
          console.warn('Could not fetch Tally companies after connect:', fetchErr)
        }
      } else {
        toast.error('Tally connection failed')
        setConnectionStatus('tally', ConnectionStatus.DISCONNECTED)
      }
      return result
    } catch (error) {
      console.error('Tally connection test failed:', error)
      toast.error(`Tally connection failed: ${error.message}`)
      setConnectionStatus('tally', ConnectionStatus.DISCONNECTED)
      return false
    }
  }, [isElectronAvailable, setConnectionStatus, setTallyCompanies])

  const getTallyCompanies = useCallback(async () => {
    if (!isElectronAvailable) return []
    try {
      const companies = await window.electronAPI.tallyGetCompanies()
      setTallyCompanies(companies || [])
      return companies || []
    } catch (error) {
      console.error('Failed to get Tally companies:', error)
      toast.error(`Failed to fetch Tally companies: ${error.message || 'Unknown error'}`)
      return []
    }
  }, [isElectronAvailable, setTallyCompanies])

  const fetchBackendCompanies = useCallback(async () => {
    if (!isElectronAvailable) return []
    try {
      const companies = await window.electronAPI.backendGetCompanies()
      return Array.isArray(companies) ? companies : []
    } catch (error) {
      console.error('Failed to load FinSync workspaces:', error)
      toast.error(error.message || 'Failed to load workspaces')
      return []
    }
  }, [isElectronAvailable])

  const hydrateLinkedCompanies = useCallback(async () => {
    if (!isElectronAvailable) return { success: false }
    try {
      const hydrateFn = window.electronAPI.hydrateLinkedCompanies
      if (typeof hydrateFn !== 'function') {
        return { success: false }
      }
      const result = await hydrateFn()
      if (result?.success) {
        const updatedConfig = await window.electronAPI.getConfig()
        if (updatedConfig) {
          setConfig(updatedConfig)
        }
      }
      return result
    } catch (error) {
      console.error('Hydrate linked companies failed:', error)
      return { success: false, error: error.message }
    }
  }, [isElectronAvailable, setConfig])

  const setCompanySyncPreferences = useCallback(async (payload) => {
    if (!isElectronAvailable) return { success: false }
    try {
      return await window.electronAPI.syncSetCompanyPreferences(payload)
    } catch (error) {
      console.error('setCompanySyncPreferences failed:', error)
      return { success: false, message: error.message }
    }
  }, [isElectronAvailable])

  const getSyncCompaniesPreview = useCallback(async () => {
    if (!isElectronAvailable) return []
    try {
      const rows = await window.electronAPI.syncGetCompaniesPreview()
      return Array.isArray(rows) ? rows : []
    } catch (error) {
      console.error('getSyncCompaniesPreview failed:', error)
      return []
    }
  }, [isElectronAvailable])

  const getOpenSyncCompaniesPreview = useCallback(async () => {
    if (!isElectronAvailable) return []
    try {
      const rows = await window.electronAPI.syncGetOpenCompaniesPreview()
      return Array.isArray(rows) ? rows : []
    } catch (error) {
      console.error('getOpenSyncCompaniesPreview failed:', error)
      return []
    }
  }, [isElectronAvailable])

  // Sync methods
  const startSync = useCallback(
    async (options = {}) => {
    if (!isElectronAvailable) return false

    if (!config?.server?.token) {
      toast.error('Please sign in before starting sync')
      return false
    }

    const billing = await refreshSubscriptionAccess()
    const access = billing?.access
    if (access && !access.allowed) {
      const blockedMessage =
        billing?.displayMessage ||
        access.reason ||
        'Error: Trial expired, purchase subscription to continue'
      toast.error(blockedMessage)
      setCurrentPage('subscription')
      return false
    }

    let latestConfig = config
    const linkedCount = (latestConfig?.server?.linkedCompanies || []).length
    const hasCompanyId = String(latestConfig?.server?.companyId || '').trim()

    if (!linkedCount && !hasCompanyId) {
      const hydrated = await hydrateLinkedCompanies()
      if (hydrated?.success) {
        latestConfig = (await window.electronAPI.getConfig()) || latestConfig
      } else {
        const stillEmpty =
          !(latestConfig?.server?.linkedCompanies || []).length &&
          !String(latestConfig?.server?.companyId || '').trim()
        if (stillEmpty) {
          toast.error(
            hydrated?.message || 'Add a Tally company first from the Add Company page'
          )
          setCurrentPage('add-company')
          return false
        }
      }
    }

    try {
      toast.loading('Sync in progress — the window may be busy while Tally exports data', {
        id: 'sync-in-progress',
        duration: 8000
      })
      const result = await window.electronAPI.syncStart(options)
      toast.dismiss('sync-in-progress')
      if (result) {
        setSyncStatus({ status: SyncStatus.RUNNING, progress: 0 })
        toast.success('Sync started')
      } else {
        toast.error('Failed to start sync')
      }
      return result
    } catch (error) {
      toast.dismiss('sync-in-progress')
      console.error('Failed to start sync:', error)
      toast.error(`Failed to start sync: ${error.message}`)
      return false
    }
  },
    [isElectronAvailable, setSyncStatus, config, setCurrentPage, hydrateLinkedCompanies, refreshSubscriptionAccess]
  )

  const stopSync = useCallback(async () => {
    if (!isElectronAvailable) return false
    try {
      const result = await window.electronAPI.syncStop()
      if (result) {
        setSyncStatus({ status: SyncStatus.IDLE })
        toast.success('Sync stopped')
      }
      return result
    } catch (error) {
      console.error('Failed to stop sync:', error)
      toast.error(`Failed to stop sync: ${error.message}`)
      return false
    }
  }, [isElectronAvailable, setSyncStatus])

  const getSyncStatus = useCallback(async () => {
    if (!isElectronAvailable) return null
    try {
      return await window.electronAPI.syncStatus()
    } catch (error) {
      console.error('Failed to get sync status:', error)
      return null
    }
  }, [isElectronAvailable])

  const resetSyncState = useCallback(async () => {
    if (!isElectronAvailable) return { success: false }
    try {
      const resetFn = window.electronAPI.syncResetState
      if (typeof resetFn !== 'function') {
        toast.error('Restart the Desktop Agent to use this feature.')
        return { success: false }
      }
      const result = await resetFn()
      if (result?.success) {
        toast.success(
          'Voucher sync progress cleared. Next run is a full sync using your saved month/year and timezone.'
        )
      } else {
        toast.error(result?.message || 'Failed to reset sync state')
      }
      return result
    } catch (error) {
      console.error('Failed to reset sync state:', error)
      toast.error(error.message || 'Failed to reset sync state')
      return { success: false, error: error.message }
    }
  }, [isElectronAvailable])

  // System methods
  const getSystemInfo = useCallback(async () => {
    if (!isElectronAvailable) return null
    try {
      return await window.electronAPI.getSystemInfo()
    } catch (error) {
      console.error('Failed to get system info:', error)
      return null
    }
  }, [isElectronAvailable])

  // Window methods
  const minimizeToTray = useCallback(() => {
    if (!isElectronAvailable) return
    window.electronAPI.minimizeToTray()
  }, [isElectronAvailable])

  const quitApp = useCallback(() => {
    if (!isElectronAvailable) return
    window.electronAPI.quitApp()
  }, [isElectronAvailable])

  const showNotification = useCallback((title, body) => {
    if (!isElectronAvailable) {
      // Fallback to toast notification
      toast(body, { icon: 'ℹ️' })
      return
    }
    window.electronAPI.showNotification(title, body)
  }, [isElectronAvailable])

  // Set up periodic system performance updates
  useEffect(() => {
    if (!isElectronAvailable) return

    const updateSystemPerformance = async () => {
      try {
        const systemInfo = await getSystemInfo()
        if (systemInfo) {
          // This would need to be implemented in the Electron main process
          // For now, we'll use mock data
          setSystemPerformance({
            cpu: { usage: Math.random() * 100, temperature: 45 + Math.random() * 20 },
            memory: { 
              usage: Math.random() * 100, 
              total: 16 * 1024 * 1024 * 1024, 
              used: Math.random() * 16 * 1024 * 1024 * 1024 
            },
            disk: [
              { 
                mount: '/', 
                usage: Math.random() * 100, 
                total: 500 * 1024 * 1024 * 1024,
                used: Math.random() * 500 * 1024 * 1024 * 1024
              }
            ],
            network: { interfaces: [], stats: [] }
          })
        }
      } catch (error) {
        console.error('Failed to update system performance:', error)
      }
    }

    // Update immediately
    updateSystemPerformance()

    // Set up periodic updates
    const interval = setInterval(updateSystemPerformance, 30000) // Every 30 seconds

    return () => clearInterval(interval)
  }, [isElectronAvailable, getSystemInfo, setSystemPerformance])

  return {
    isElectronAvailable,
    initializeAPI,
    
    // Configuration
    getConfig,
    setConfig: setConfigValue,
    serverLogin,
    serverRegister,
    serverForgotPassword,
    serverResetPassword,
    
    // Tally
    testTallyConnection,
    getTallyCompanies,
    fetchBackendCompanies,
    linkTallyCompany,
    unlinkTallyCompany,
    hydrateLinkedCompanies,

    // Sync
    startSync,
    setCompanySyncPreferences,
    getSyncCompaniesPreview,
    getOpenSyncCompaniesPreview,
    stopSync,
    getSyncStatus,
    resetSyncState,
    
    // Authentication
    serverLogout,

    refreshSubscriptionAccess,

    // Billing
    billingGetStatus: () => {
      if (!isElectronAvailable) throw new Error('Electron API not available')
      return window.electronAPI.billingGetStatus()
    },
    billingSubscribe: (payload) => {
      if (!isElectronAvailable) throw new Error('Electron API not available')
      return window.electronAPI.billingSubscribe(payload)
    },
    billingSync: () => {
      if (!isElectronAvailable) throw new Error('Electron API not available')
      return window.electronAPI.billingSync()
    },
    billingOpenUrl: (url) => {
      if (!isElectronAvailable) return
      return window.electronAPI.billingOpenUrl(url)
    },
    
    // System
    getSystemInfo,
    
    // Window
    minimizeToTray,
    quitApp,
    showNotification
  }
}
