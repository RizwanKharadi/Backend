import React, { useState } from 'react'
import { ServerIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline'
import Card from '../components/common/Card'
import Button from '../components/common/Button'
import Input from '../components/common/Input'
import Badge from '../components/common/Badge'
import { useAppStore } from '../stores/appStore'
import { useElectronAPI } from '../hooks/useElectronAPI'
import { ConnectionStatus } from '../types'
import toast from 'react-hot-toast'

const TallyConnection = () => {
  const { connectionStatus, config, updateConfig } = useAppStore()
  const { testTallyConnection, setConfig } = useElectronAPI()

  const [tallyConfig, setTallyConfig] = useState({
    host: config.tally.host,
    port: config.tally.port,
    timeout: config.tally.timeout
  })

  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [serialWarning, setSerialWarning] = useState(null)

  const handleConfigChange = (field, value) => {
    setTallyConfig((prev) => ({ ...prev, [field]: value }))
  }

  const handleSaveConfig = async (e) => {
    e.preventDefault()

    if (!tallyConfig.host.trim()) {
      toast.error('Host is required')
      return
    }
    if (tallyConfig.port < 1 || tallyConfig.port > 65535) {
      toast.error('Port must be between 1 and 65535')
      return
    }
    if (tallyConfig.timeout < 60000) {
      toast.error('Timeout must be at least 60000 ms (1 minute)')
      return
    }

    const newConfig = {
      ...config,
      tally: { ...config.tally, ...tallyConfig }
    }

    await setConfig(newConfig)
    Object.entries(tallyConfig).forEach(([key, value]) => {
      updateConfig(`tally.${key}`, value)
    })
    toast.success('Tally configuration saved successfully')
  }

  const handleTestConnection = async () => {
    setIsTestingConnection(true)
    setSerialWarning(null)
    try {
      const result = await testTallyConnection()
      if (result?.serialCheck?.inUse) {
        setSerialWarning(
          `This Tally serial number is already registered with ${result.serialCheck.registeredEmail || 'another account'}.`
        )
      }
    } finally {
      setIsTestingConnection(false)
    }
  }

  const getConnectionStatusBadge = (status) => {
    switch (status) {
      case ConnectionStatus.CONNECTED:
        return <Badge variant="success">Connected</Badge>
      case ConnectionStatus.CONNECTING:
        return <Badge variant="warning">Connecting</Badge>
      case ConnectionStatus.ERROR:
        return <Badge variant="error">Error</Badge>
      default:
        return <Badge variant="secondary">Disconnected</Badge>
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tally Connection</h1>
        <p className="text-gray-600">Configure host and port for Tally ERP on this machine</p>
      </div>

      {serialWarning && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {serialWarning}
        </div>
      )}

      <Card title="Connection Status">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-primary-100 rounded-lg">
              <ServerIcon className="w-8 h-8 text-primary-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Tally ERP</h3>
              <p className="text-sm text-gray-600">
                {tallyConfig.host}:{tallyConfig.port}
              </p>
            </div>
          </div>
          {getConnectionStatusBadge(connectionStatus.tally)}
        </div>
      </Card>

      <Card
        title="Tally Connection Settings"
        actions={
          <Button
            variant="primary"
            icon={WrenchScrewdriverIcon}
            onClick={handleTestConnection}
            loading={isTestingConnection}
            size="sm"
          >
            Test Connection
          </Button>
        }
      >
        <form onSubmit={handleSaveConfig} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="Tally Host"
              type="text"
              value={tallyConfig.host}
              onChange={(e) => handleConfigChange('host', e.target.value)}
              placeholder="localhost"
              required
              helperText="IP address or hostname where Tally is running"
            />
            <Input
              label="Tally Port"
              type="number"
              value={tallyConfig.port}
              onChange={(e) => handleConfigChange('port', parseInt(e.target.value, 10) || 9000)}
              min="1"
              max="65535"
              required
              helperText="Default: 9000"
            />
          </div>
          <Input
            label="Tally HTTP timeout (ms)"
            type="number"
            value={tallyConfig.timeout}
            onChange={(e) => handleConfigChange('timeout', parseInt(e.target.value, 10) || 900000)}
            min="60000"
            max="3600000"
            required
            className="md:w-1/2"
            helperText="Max wait per Tally XML export (parties, items, vouchers). Large data needs several minutes; values under 5 minutes are raised automatically when saved."
          />
          <div className="flex justify-end">
            <Button type="submit" variant="primary">Save Settings</Button>
          </div>
        </form>
      </Card>

      <Card title="Company linking">
        <p className="text-sm text-gray-600">
          Open a company in Tally, then link and sync it from the <strong>Add Company</strong> page in the sidebar.
        </p>
      </Card>
    </div>
  )
}

export default TallyConnection
