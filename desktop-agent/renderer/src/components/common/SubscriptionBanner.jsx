import React from 'react'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { useAppStore } from '../../stores/appStore'

const SubscriptionBanner = ({ onGoToSubscription }) => {
  const { subscriptionAccess } = useAppStore()

  if (subscriptionAccess.allowed) {
    return null
  }

  const message =
    subscriptionAccess.displayMessage ||
    subscriptionAccess.reason ||
    'Error: Trial expired, purchase subscription to continue'

  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-900"
    >
      <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0 text-red-600 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{message}</p>
        {onGoToSubscription && (
          <button
            type="button"
            onClick={onGoToSubscription}
            className="mt-1 text-sm font-medium text-red-700 underline hover:text-red-900"
          >
            Open Subscription
          </button>
        )}
      </div>
    </div>
  )
}

export default SubscriptionBanner
