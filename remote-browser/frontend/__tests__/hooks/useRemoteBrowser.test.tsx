import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * RED: hooks/useRemoteBrowser.ts doesn't exist yet.
 *
 * useRemoteBrowser manages the WebSocket connection to the backend.
 *
 * States:
 *   idle        → initial, no connection
 *   connecting  → WS opening
 *   streaming   → session_ready received + frames incoming
 *   error       → connection or session error
 *   stopped     → session_ended or explicit stop
 *
 * Responsibilities:
 *   - startSession(): POST /session/start then open WS
 *   - stopSession(): send DELETE /session/stop then close WS
 *   - On binary WS message: call onFrame(buffer)
 *   - On JSON 'session_ready': transition to 'streaming'
 *   - On JSON 'session_ended': transition to 'stopped'
 *   - On JSON 'error': transition to 'error'
 *   - On WS close: transition to 'stopped' (if streaming)
 */

// Mock global WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState = 0; // CONNECTING

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send = vi.fn();
  close = vi.fn().mockImplementation(() => {
    this.readyState = 3; // CLOSED
    this.onclose?.({ type: 'close' } as any);
  });

  // Helper: simulate server sending a message
  simulateMessage(data: string | ArrayBuffer) {
    this.onmessage?.({ data } as any);
  }

  // Helper: simulate successful connection
  simulateOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.({ type: 'open' } as any);
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ containerId: 'test-id', hostPort: 49300 }),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useRemoteBrowser', () => {
  it('starts in idle state', async () => {
    const { useRemoteBrowser } = await import('../../hooks/useRemoteBrowser');
    const { result } = renderHook(() => useRemoteBrowser({ wsUrl: 'ws://localhost:3001/ws', apiUrl: 'http://localhost:3001' }));
    expect(result.current.status).toBe('idle');
  });

  it('transitions to streaming after session_ready', async () => {
    const { useRemoteBrowser } = await import('../../hooks/useRemoteBrowser');
    const { result } = renderHook(() => useRemoteBrowser({ wsUrl: 'ws://localhost:3001/ws', apiUrl: 'http://localhost:3001' }));

    await act(async () => {
      await result.current.startSession();
    });

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    act(() => {
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'session_ready', sessionId: 'abc' }));
    });

    expect(result.current.status).toBe('streaming');
  });

  it('calls onFrame when binary message received', async () => {
    const onFrame = vi.fn();
    const { useRemoteBrowser } = await import('../../hooks/useRemoteBrowser');
    const { result } = renderHook(() => useRemoteBrowser({ wsUrl: 'ws://localhost:3001/ws', apiUrl: 'http://localhost:3001', onFrame }));

    await act(async () => { await result.current.startSession(); });
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => {
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'session_ready' }));
    });

    // Binary frame (ArrayBuffer)
    const fakeFrame = new ArrayBuffer(100);
    act(() => { ws.simulateMessage(fakeFrame); });

    expect(onFrame).toHaveBeenCalledWith(fakeFrame);
  });

  it('transitions to error on JSON error message', async () => {
    const { useRemoteBrowser } = await import('../../hooks/useRemoteBrowser');
    const { result } = renderHook(() => useRemoteBrowser({ wsUrl: 'ws://localhost:3001/ws', apiUrl: 'http://localhost:3001' }));

    await act(async () => { await result.current.startSession(); });
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => {
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'error', message: 'Container failed' }));
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/Container failed/i);
  });

  it('sendInput sends JSON over WS', async () => {
    const { useRemoteBrowser } = await import('../../hooks/useRemoteBrowser');
    const { result } = renderHook(() => useRemoteBrowser({ wsUrl: 'ws://localhost:3001/ws', apiUrl: 'http://localhost:3001' }));

    await act(async () => { await result.current.startSession(); });
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => {
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'session_ready' }));
    });

    act(() => { result.current.sendInput({ type: 'click', x: 100, y: 200 }); });
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'click', x: 100, y: 200 }));
  });
});
