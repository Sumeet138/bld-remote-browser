'use client';

import { useRef, useState, useCallback } from 'react';

type Status = 'idle' | 'connecting' | 'streaming' | 'error' | 'stopped';

interface UseRemoteBrowserOptions {
  wsUrl: string;
  apiUrl: string;
  onFrame?: (data: ArrayBuffer) => void;
}

interface UseRemoteBrowserReturn {
  status: Status;
  error: string | null;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  sendInput: (msg: object) => void;
}

/**
 * React hook that manages the WebSocket connection + session lifecycle.
 *
 * Workflow:
 *   startSession() → POST /session/start → open WebSocket → wait for session_ready
 *   onmessage binary → onFrame(buffer)    (JPEG frame from screencast)
 *   onmessage JSON   → route by type
 *   stopSession()    → DELETE /session/stop → close WS
 *
 * Canvas rendering happens in the page component, not here —
 * the hook just delivers raw ArrayBuffer frames via onFrame callback.
 *
 * URL.revokeObjectURL() responsibility is on the caller (page.tsx)
 * to prevent memory leaks (PRD section 11 requirement).
 */
export function useRemoteBrowser({
  wsUrl,
  apiUrl,
  onFrame,
}: UseRemoteBrowserOptions): UseRemoteBrowserReturn {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const startSession = useCallback(async () => {
    // Close any existing WebSocket before starting a new session
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent status change from old socket
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus('connecting');
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/session/start`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? 'Failed to start session');
      }
    } catch (err: any) {
      setStatus('error');
      setError(err.message);
      return;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // POST /session/start only resolves once Chromium + screencast are ready,
      // so by the time WS opens the session is already live. We may have missed
      // the server's session_ready (it was broadcast before this socket existed).
      setStatus('streaming');
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        // JSON control message
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'session_ready':
            setStatus('streaming');
            break;
          case 'session_ended':
            setStatus('stopped');
            break;
          case 'error':
            setStatus('error');
            setError(msg.message ?? 'Unknown error');
            break;
        }
      } else {
        // Binary JPEG frame
        if (onFrame) {
          onFrame(event.data as ArrayBuffer);
        }
      }
    };

    ws.onclose = () => {
      setStatus((prev) => (prev === 'streaming' ? 'stopped' : prev));
      wsRef.current = null;
    };

    ws.onerror = () => {
      setStatus('error');
      setError('WebSocket connection error');
    };
  }, [wsUrl, apiUrl, onFrame]);

  const stopSession = useCallback(async () => {
    try {
      await fetch(`${apiUrl}/session/stop`, { method: 'DELETE' });
    } catch {
      // best-effort
    }
    wsRef.current?.close();
    wsRef.current = null;
    setStatus('stopped');
  }, [apiUrl]);

  const sendInput = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { status, error, startSession, stopSession, sendInput };
}
