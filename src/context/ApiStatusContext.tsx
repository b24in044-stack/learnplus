import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { ApiHealthResponse } from '../types';

interface ApiStatusContextType {
  apiUrl: string;
  setApiUrl: (url: string) => void;
  isLive: boolean;
  isChecking: boolean;
  latencyMs: number;
  lastChecked: Date | null;
  healthData?: ApiHealthResponse;
  checkHealth: () => Promise<void>;
  reconnect: () => Promise<void>;
  statusMessage: string;
}

const ApiStatusContext = createContext<ApiStatusContextType | undefined>(undefined);

export const ApiStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apiUrl, setApiUrlState] = useState<string>(api.getBaseUrl());
  const [isLive, setIsLive] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [healthData, setHealthData] = useState<ApiHealthResponse | undefined>(undefined);
  const [statusMessage, setStatusMessage] = useState<string>('Initializing API probe...');

  const checkHealth = useCallback(async () => {
    setIsChecking(true);
    try {
      const res = await api.checkHealth();
      setIsLive(res.isLive);
      setLatencyMs(res.latencyMs);
      setLastChecked(new Date());

      if (res.isLive) {
        setHealthData(res.response);
        setStatusMessage(`Connected to Express API (${res.latencyMs}ms)`);
      } else {
        setStatusMessage(
          `API not detected at ${api.getBaseUrl()}. Check the backend connection or enable demo mode.`
        );
      }
    } catch {
      setIsLive(false);
      setStatusMessage('API health check failed. Check that the backend is running.');
    } finally {
      setIsChecking(false);
    }
  }, []);

  const setApiUrl = (url: string) => {
    api.setBaseUrl(url);
    setApiUrlState(api.getBaseUrl());
    checkHealth();
  };

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  return (
    <ApiStatusContext.Provider
      value={{
        apiUrl,
        setApiUrl,
        isLive,
        isChecking,
        latencyMs,
        lastChecked,
        healthData,
        checkHealth,
        reconnect: checkHealth,
        statusMessage
      }}
    >
      {children}
    </ApiStatusContext.Provider>
  );
};

export const useApiStatus = () => {
  const context = useContext(ApiStatusContext);
  if (!context) {
    throw new Error('useApiStatus must be used within an ApiStatusProvider');
  }
  return context;
};
