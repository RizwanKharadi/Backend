import React, { useEffect, useState } from 'react'
import { CreditCardIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import Card from '../components/common/Card'
import Button from '../components/common/Button'
import { useElectronAPI } from '../hooks/useElectronAPI'
import toast from 'react-hot-toast'

const Subscription = () => {
  const { billingGetStatus, billingSubscribe, billingSync, billingOpenUrl, refreshSubscriptionAccess } =
    useElectronAPI()
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)
  const [billingCycle, setBillingCycle] = useState('monthly')
  const [seatLimit, setSeatLimit] = useState(1)

  const load = async () => {
    setLoading(true)
    try {
      const data = await billingGetStatus()
      setStatus(data)
      if (data?.subscription?.seatLimit) {
        setSeatLimit(data.subscription.seatLimit)
      }
    } catch (e) {
      toast.error(e.message || 'Failed to load subscription')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleSubscribe = async () => {
    try {
      const checkout = await billingSubscribe({ billingCycle, seatLimit })
      if (checkout?.shortUrl) {
        await billingOpenUrl(checkout.shortUrl)
        toast.success(
          'After payment succeeds in the browser, click “Activate subscription” below.',
          { duration: 12000 }
        )
      }
    } catch (e) {
      const msg = e?.message || 'Checkout failed'
      toast.error(msg, { duration: 10000 })
      console.error('billing subscribe failed:', e)
    }
  }

  const handleActivateAfterPayment = async () => {
    try {
      const data = await billingSync()
      await load()
      await refreshSubscriptionAccess()
      if (data?.access?.allowed) {
        toast.success('Subscription is active. Server connection restored.')
      } else {
        toast.error(
          data?.reconnect?.reason ||
            `Razorpay status: ${data?.razorpayStatus || 'unknown'}. Wait a minute and try again.`,
          { duration: 10000 }
        )
      }
    } catch (e) {
      toast.error(e.message || 'Could not activate subscription')
    }
  }

  if (loading) {
    return <Card title="Subscription">Loading…</Card>
  }

  const access = status?.access
  const sub = status?.subscription

  const blockedMessage =
    status?.displayMessage ||
    (!access?.allowed
      ? access?.reason || 'Error: Trial expired, purchase subscription to continue'
      : null)

  return (
    <div className="space-y-6">
      {blockedMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 font-medium">
          {blockedMessage}
        </div>
      )}
      <Card title="License & Subscription" subtitle="This PC counts as one device seat. Mobile app is included.">
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-gray-600 mb-2">Status</p>
            <p className="text-lg font-semibold capitalize">{sub?.status || 'unknown'}</p>
            <p className="text-sm text-gray-500 mt-2">
              Devices: {status?.seatsUsed ?? 0} / {sub?.seatLimit ?? 0}
            </p>
            {sub?.trialEndsAt && (
              <p className="text-sm text-gray-500">Trial ends: {new Date(sub.trialEndsAt).toLocaleString()}</p>
            )}
            {!access?.allowed && (
              <p className="mt-3 text-sm text-amber-700 bg-amber-50 p-2 rounded">{access?.reason}</p>
            )}
            <Button variant="primary" className="mt-4" onClick={handleActivateAfterPayment}>
              Activate subscription (after payment)
            </Button>
            <Button variant="outline" className="mt-2 ml-2" onClick={load}>
              Refresh status
            </Button>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Upgrade</p>
            <select
              className="w-full border rounded-md px-3 py-2 mb-3"
              value={billingCycle}
              onChange={(e) => setBillingCycle(e.target.value)}
            >
              <option value="monthly">Monthly per device</option>
              <option value="yearly">Yearly per device</option>
            </select>
            <label className="block text-sm text-gray-600 mb-1">Number of Tally PCs</label>
            <input
              type="number"
              min={1}
              max={50}
              className="w-full border rounded-md px-3 py-2 mb-4"
              value={seatLimit}
              onChange={(e) => setSeatLimit(parseInt(e.target.value, 10) || 1)}
            />
            <Button onClick={handleSubscribe} className="w-full flex items-center justify-center gap-2">
              <CreditCardIcon className="h-5 w-5" />
              Pay with Razorpay
              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default Subscription

