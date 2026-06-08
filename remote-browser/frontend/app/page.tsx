'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { useRemoteBrowser } from '@/hooks/useRemoteBrowser';
import { scaleCoordinates } from '@/utils/coords';
import { Globe, Play, Square, Loader2, ArrowRight, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws';

export default function RemoteBrowserPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [urlInput, setUrlInput] = useState('https://duckduckgo.com');
  
  const frameCountRef = useRef(0);
  const [frameCount, setFrameCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [uptime, setUptime] = useState(0);
  const rafIdRef = useRef<number>(0);
  const pendingBitmapRef = useRef<ImageBitmap | null>(null);

  const onFrame = useCallback((data: ArrayBuffer) => {
    const blob = new Blob([data], { type: 'image/jpeg' });
    createImageBitmap(blob).then((bitmap) => {
      pendingBitmapRef.current?.close();
      pendingBitmapRef.current = bitmap;

      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = 0;
          const bmp = pendingBitmapRef.current;
          const canvas = canvasRef.current;
          if (!bmp || !canvas) return;

          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          ctx.drawImage(bmp, 0, 0, VIEWPORT_W, VIEWPORT_H);
          bmp.close();
          pendingBitmapRef.current = null;

          frameCountRef.current += 1;
          setFrameCount(frameCountRef.current);
        });
      }
    });
  }, []);

  const { status, error, startSession, stopSession, sendInput } = useRemoteBrowser({
    wsUrl: WS_URL,
    apiUrl: BACKEND_URL,
    onFrame,
  });

  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current !== 'streaming' && status === 'streaming' && urlInput) {
      sendInput({ type: 'navigate', url: urlInput });
    }
    prevStatus.current = status;
  }, [status, urlInput, sendInput]);

  useEffect(() => {
    if (status !== 'streaming') {
      setFps(0);
      setUptime(0);
      return;
    }

    let lastFrames = frameCountRef.current;
    const interval = setInterval(() => {
      setFps(frameCountRef.current - lastFrames);
      lastFrames = frameCountRef.current;
      setUptime((u) => u + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [status]);

  const formatUptime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const getScaledCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return scaleCoordinates(e.clientX, e.clientY, rect, VIEWPORT_W, VIEWPORT_H);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (status !== 'streaming') return;
      const { x, y } = getScaledCoords(e);
      sendInput({ type: 'click', x, y });
    },
    [status, getScaledCoords, sendInput],
  );

  const lastMouseMoveRef = useRef(0);
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (status !== 'streaming') return;
      const now = Date.now();
      if (now - lastMouseMoveRef.current < 32) return; // ~30fps throttle
      lastMouseMoveRef.current = now;
      const { x, y } = getScaledCoords(e);
      sendInput({ type: 'mousemove', x, y });
    },
    [status, getScaledCoords, sendInput],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (status !== 'streaming') return;
      const { x, y } = getScaledCoords(e as unknown as React.MouseEvent<HTMLCanvasElement>);
      sendInput({ type: 'scroll', x, y, deltaY: e.deltaY });
    },
    [status, getScaledCoords, sendInput],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (status !== 'streaming') return;
      if (e.repeat) return; // prevent held-key spam
      e.preventDefault();
      sendInput({ type: 'keydown', key: e.key });
    },
    [status, sendInput],
  );

  const navigateTo = useCallback(() => {
    if (status !== 'streaming') return;
    sendInput({ type: 'navigate', url: urlInput });
  }, [status, urlInput, sendInput]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      pendingBitmapRef.current?.close();
    };
  }, []);

  const isIdle = status === 'idle' || status === 'stopped';
  const isStreaming = status === 'streaming';
  const isConnecting = status === 'connecting';
  const isError = status === 'error';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center font-sans p-4 pb-32 lg:p-8 lg:pb-32 bg-[#f8f9fa]">
      
      {/* Top Title */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 text-center"
      >
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Remote Browser</h1>
      </motion.div>

      {/* Main Canvas Area */}
      <motion.div 
        layout
        className="relative w-[90vw] max-w-[1500px] bg-white rounded-2xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] overflow-hidden border border-gray-200/60 flex flex-col items-center"
      >
        {/* Mac Browser Header */}
        <div className="w-full h-14 bg-[#f1f1f1] border-b border-gray-200/80 flex items-center px-4 relative z-10">
          {/* Traffic Lights */}
          <div className="flex gap-2 items-center absolute left-4">
            <div className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-pointer" onClick={isStreaming || isConnecting ? stopSession : undefined} />
            <div className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123]" />
            <div className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29]" />
          </div>

          {/* Top URL Bar */}
          <div className="flex-1 flex justify-center">
            <div className="flex items-center bg-white border border-gray-200/80 rounded-md px-3 py-1.5 w-full max-w-lg shadow-sm group hover:border-gray-300 transition-colors">
              <Lock className="w-3.5 h-3.5 text-gray-400 mr-2" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && navigateTo()}
                placeholder="Search or enter website name"
                className="w-full bg-transparent outline-none text-xs text-gray-600 font-medium placeholder:text-gray-400"
              />
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex w-full">
          {/* Browser Canvas */}
          <div className="relative flex-1 aspect-video flex flex-col items-center justify-center bg-white">
            <AnimatePresence mode="wait">
              {isIdle && (
                <motion.div 
                  key="idle"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.05 }}
                  className="flex flex-col items-center gap-6 text-gray-400 my-auto"
                >
                  <motion.div 
                    animate={{ y: [0, -10, 0] }}
                    transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                  >
                    <Globe className="w-16 h-16 text-gray-200 stroke-[1]" />
                  </motion.div>
                  <p className="text-sm font-medium tracking-widest uppercase text-gray-400">Ready</p>
                </motion.div>
              )}

              {isConnecting && (
                <motion.div 
                  key="connecting"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.1 }}
                  className="flex flex-col items-center gap-6 text-gray-500 my-auto"
                >
                  <Loader2 className="w-10 h-10 animate-spin text-blue-500 stroke-[1.5]" />
                  <p className="text-sm font-medium tracking-wide">Connecting to remote environment...</p>
                </motion.div>
              )}

              {isError && (
                <motion.div 
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-4 text-red-500 my-auto"
                >
                  <p className="text-sm font-semibold tracking-wide">Connection failed: {error}</p>
                </motion.div>
              )}

              {isStreaming && (
                <motion.div
                  key="canvas"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="absolute inset-0 w-full h-full"
                >
                  <canvas
                    ref={canvasRef}
                    width={VIEWPORT_W}
                    height={VIEWPORT_H}
                    className="w-full h-full object-contain outline-none cursor-crosshair bg-black"
                    tabIndex={0}
                    onClick={handleClick}
                    onMouseMove={handleMouseMove}
                    onWheel={handleWheel}
                    onKeyDown={handleKeyDown}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Sidebar (Metrics) */}
          <div className="bg-[#fcfcfc] w-[220px] border-l border-gray-200/80 flex flex-col px-6 py-8 text-[10px] text-gray-500 font-mono tracking-wider uppercase z-10 shrink-0 gap-6 overflow-hidden whitespace-nowrap">
            <div className="text-xs font-bold text-gray-800 mb-2">Telemetry</div>
            
            <div className="flex flex-col gap-1">
              <span className="text-gray-400">FPS</span>
              <span className="text-xl font-sans font-medium text-gray-800 tracking-normal">
                {isStreaming ? fps : '-'}
              </span>
            </div>
            
            <div className="flex flex-col gap-1">
              <span className="text-gray-400">Frames</span>
              <span className="text-xl font-sans font-medium text-gray-800 tracking-normal">
                {isStreaming ? frameCount : '-'}
              </span>
            </div>
            
            <div className="flex flex-col gap-1">
              <span className="text-gray-400">Uptime</span>
              <span className="text-xl font-sans font-medium text-gray-800 tracking-normal">
                {isStreaming ? formatUptime(uptime) : '--:--'}
              </span>
            </div>

            <div className="w-full h-px bg-gray-200 my-2" />

            <div className="flex flex-col gap-1">
              <span className="text-gray-400">Resolution</span>
              <span className="text-sm text-gray-800">1280x720</span>
            </div>
            
            <div className="flex flex-col gap-1">
              <span className="text-gray-400">Quality</span>
              <span className="text-sm text-gray-800">75% JPEG</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Floating Control Bar */}
      <motion.div 
        layout
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 20 }}
        className="fixed bottom-8 flex items-center justify-between gap-4 p-2 bg-white/90 backdrop-blur-2xl rounded-full shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] border border-gray-200 w-[90%] max-w-3xl"
      >
        <div className="flex items-center gap-3 flex-1 pl-6">
          <Globe className="w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && navigateTo()}
            placeholder="Search or enter website name"
            className="flex-1 bg-transparent outline-none text-sm text-gray-700 font-medium placeholder:text-gray-400 w-full"
          />
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={navigateTo}
            disabled={!isStreaming}
            className="p-2 text-gray-400 hover:text-blue-500 disabled:opacity-40 transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
          </motion.button>
        </div>

        <div className="w-px h-8 bg-gray-200 mx-2" />

        <div className="flex items-center gap-4 pr-2">
          {/* Status Indicator */}
          <div className="flex items-center gap-2">
            <motion.div 
              layout
              className={`w-2.5 h-2.5 rounded-full ${
                isStreaming ? 'bg-green-500' :
                isConnecting ? 'bg-yellow-500' :
                isError ? 'bg-red-500' : 'bg-gray-300'
              }`} 
              animate={{
                boxShadow: isConnecting ? ['0 0 0 0 rgba(234,179,8,0)', '0 0 0 10px rgba(234,179,8,0.2)', '0 0 0 0 rgba(234,179,8,0)'] : 'none',
              }}
              transition={{ repeat: isConnecting ? Infinity : 0, duration: 1.5 }}
            />
          </div>

          <AnimatePresence mode="wait">
            {isIdle || isError ? (
              <motion.button
                key="start"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={startSession}
                className="flex items-center gap-2 px-6 py-2.5 bg-gray-900 text-white rounded-full text-sm font-semibold shadow-md"
              >
                <Play className="w-4 h-4 fill-current" />
                Start
              </motion.button>
            ) : (
              <motion.button
                key="stop"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={stopSession}
                className="flex items-center gap-2 px-6 py-2.5 bg-red-50 text-red-600 rounded-full text-sm font-semibold border border-red-100"
              >
                <Square className="w-4 h-4 fill-current" />
                Stop
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

