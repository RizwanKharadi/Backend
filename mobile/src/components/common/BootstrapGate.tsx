import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../../store';
import { bootstrapSession } from '../../store/thunks/bootstrapSession';
import LoadingScreen from './LoadingScreen';

interface BootstrapGateProps {
  children: React.ReactNode;
}

/**
 * Restores company on cold start and connects real-time services after auth.
 */
const BootstrapGate: React.FC<BootstrapGateProps> = ({ children }) => {
  const dispatch = useDispatch<AppDispatch>();
  const isAuthenticated = useSelector((s: RootState) => s.auth.isAuthenticated);
  const selectedCompany = useSelector((s: RootState) => s.company.selectedCompany);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!isAuthenticated) {
        if (!cancelled) setReady(true);
        return;
      }

      try {
        try {
          await dispatch(bootstrapSession()).unwrap();
        } catch {
          /* persisted company + cached vouchers still usable offline */
        }
      } catch {
        // Persisted company + cache still allow offline use
      } finally {
        if (!cancelled) setReady(true);
      }
    };

    setReady(false);
    run();

    return () => {
      cancelled = true;
    };
  }, [dispatch, isAuthenticated, selectedCompany?.id]);

  if (!ready) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
};

export default BootstrapGate;
