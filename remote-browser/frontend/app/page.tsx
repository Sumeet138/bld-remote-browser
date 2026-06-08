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
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [urlInput, setUrlInput] = useState('https://google.com');
  const [frameCount, setFrameCount] = useState(0);

  const onFrame = useCallback((data: ArrayBuffer) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (imgRef.current?.src) {
      URL.revokeObjectURL(imgRef.current.src);
    }

    const blob = new Blob([data], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      setFrameCount((c) => c + 1);
    };
    img.src = url;
    imgRef.current = img;
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

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (status !== 'streaming') return;
      const { x, y } = getScaledCoords(e);
      sendInput({ type: 'mousemove', x, y });
    },
    [status, getScaledCoords, sendInput],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (status !== 'streaming') return;
      const { x, y } = getScaledCoords(e as any);
      sendInput({ type: 'scroll', x, y, deltaY: e.deltaY });
    },
    [status, getScaledCoords, sendInput],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (status !== 'streaming') return;
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
      if (imgRef.current?.src) URL.revokeObjectURL(imgRef.current.src);
    };
  }, []);

  const isIdle = status === 'idle' || status === 'stopped';
  const isStreaming = status === 'streaming';
  const isConnecting = status === 'connecting';
  const isError = status === 'error';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center font-sans p-4 lg:p-8 bg-[#f8f9fa]">
      
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
        className="relative w-full max-w-[1400px] bg-white rounded-2xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] overflow-hidden border border-gray-200/60 flex flex-col items-center"
      >
        {/* Mac Browser Header */}
        <div className="w-full h-14 bg-[#f1f1f1] border-b border-gray-200/80 flex items-center px-4 relative">
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

        {/* Browser Content */}
        <div className="relative w-full aspect-video flex flex-col items-center justify-center bg-white">
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
              <motion.canvas
                key="canvas"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                ref={canvasRef}
                width={VIEWPORT_W}
                height={VIEWPORT_H}
                className="absolute inset-0 w-full h-full object-contain outline-none cursor-crosshair bg-black"
                tabIndex={0}
                onClick={handleClick}
                onMouseMove={handleMouseMove}
                onWheel={handleWheel}
                onKeyDown={handleKeyDown}
              />
            )}
          </AnimatePresence>
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

