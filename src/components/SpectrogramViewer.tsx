import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Activity, BarChart2, Volume2, Sparkles, RefreshCw } from 'lucide-react';
import { getAudioContext } from '../utils/audioSynth';

interface SpectrogramViewerProps {
  analyserNode?: AnalyserNode | null;
  isActive: boolean;
  highlightDominantHz?: number;
  label?: string;
  onSnapshot?: (dataUrl: string) => void;
  theme?: 'dark' | 'light';
}

// Precompute 256-color bioacoustic colormap LUT for zero GC in animation loop
const COLOR_LUT: string[] = (() => {
  const lut: string[] = [];
  for (let val = 0; val < 256; val++) {
    if (val < 15) {
      lut.push('#090d16');
    } else {
      const r = Math.min(255, Math.floor(val * 1.8));
      const g = Math.min(255, Math.max(0, Math.floor((val - 65) * 2.2)));
      const b = Math.min(255, Math.max(20, Math.floor((val - 130) * 3)));
      lut.push(`rgb(${r},${g},${b})`);
    }
  }
  return lut;
})();

export const SpectrogramViewer: React.FC<SpectrogramViewerProps> = ({
  analyserNode,
  isActive,
  highlightDominantHz,
  label,
  onSnapshot,
  theme = 'dark',
}) => {
  const isDark = theme === 'dark';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [viewMode, setViewMode] = useState<'spectrogram' | 'waveform'>('spectrogram');
  const [currentPeakHz, setCurrentPeakHz] = useState<number>(highlightDominantHz || 3200);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 680, height: 210 });

  const animFrameIdRef = useRef<number | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const timeDomainArrayRef = useRef<Uint8Array | null>(null);
  const lastActiveTimestampRef = useRef<number>(Date.now());

  // Keep target frequency updated
  useEffect(() => {
    if (highlightDominantHz) {
      setCurrentPeakHz(highlightDominantHz);
    }
  }, [highlightDominantHz]);

  // Handle Container Resizing via ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 50 && height > 50) {
          setDimensions({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });

    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Main Audio Rendering & Waterfall Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // Set real pixel canvas dimensions
    const width = dimensions.width;
    const height = dimensions.height;
    canvas.width = width;
    canvas.height = height;

    // Setup or resize offscreen waterfall canvas
    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
    }
    const offscreen = offscreenCanvasRef.current;
    if (offscreen.width !== width || offscreen.height !== height) {
      offscreen.width = width;
      offscreen.height = height;
      const offCtx = offscreen.getContext('2d', { alpha: false });
      if (offCtx) {
        offCtx.fillStyle = '#090d16';
        offCtx.fillRect(0, 0, width, height);
      }
    }
    const offCtx = offscreen.getContext('2d', { alpha: false });

    // Use passed analyser or fallback
    let analyser = analyserNode;
    if (!analyser) {
      try {
        const audioCtx = getAudioContext();
        if (!localAnalyserRef.current) {
          const newAnalyser = audioCtx.createAnalyser();
          newAnalyser.fftSize = 1024;
          newAnalyser.smoothingTimeConstant = 0.75;
          localAnalyserRef.current = newAnalyser;
        }
        analyser = localAnalyserRef.current;
      } catch {
        // audio context not ready
      }
    }

    if (analyser) {
      const binCount = analyser.frequencyBinCount;
      if (!dataArrayRef.current || dataArrayRef.current.length !== binCount) {
        dataArrayRef.current = new Uint8Array(binCount);
        timeDomainArrayRef.current = new Uint8Array(binCount);
      }
    }

    const dataArray = dataArrayRef.current;
    const timeDomainArray = timeDomainArrayRef.current;

    let lastDrawTime = 0;
    const startX = 42; // Width of frequency axis scale

    const render = (now: number) => {
      if (isActive) {
        lastActiveTimestampRef.current = now;
      }

      // Idle throttling: if inactive for > 2s, throttle rendering to save energy
      const isIdle = !isActive && now - lastActiveTimestampRef.current > 2000;
      if (isIdle && now - lastDrawTime < 60) {
        animFrameIdRef.current = requestAnimationFrame(render);
        return;
      }
      lastDrawTime = now;

      // 1. Audio data sampling
      if (isActive && analyser && dataArray && timeDomainArray) {
        analyser.getByteFrequencyData(dataArray);
        analyser.getByteTimeDomainData(timeDomainArray);

        // Compute dominant peak frequency
        let maxVal = 0;
        let maxIdx = 0;
        const scanRange = Math.floor(dataArray.length * 0.6); // up to ~13kHz
        for (let i = 2; i < scanRange; i++) {
          if (dataArray[i] > maxVal) {
            maxVal = dataArray[i];
            maxIdx = i;
          }
        }
        if (maxVal > 45) {
          const sampleRate = getAudioContext().sampleRate;
          const detectedHz = Math.round((maxIdx * sampleRate) / (dataArray.length * 2));
          if (detectedHz >= 200 && detectedHz <= 14000) {
            setCurrentPeakHz(detectedHz);
          }
        }
      }

      // 2. Spectrogram or Waveform Rendering
      if (viewMode === 'spectrogram') {
        if (offCtx) {
          const plotWidth = width - startX;
          const scrollStep = 2;

          if (isActive && dataArray) {
            // Shift offscreen waterfall canvas left by scrollStep
            offCtx.drawImage(
              offscreen,
              startX + scrollStep,
              0,
              plotWidth - scrollStep,
              height,
              startX,
              0,
              plotWidth - scrollStep,
              height
            );

            // Draw new column at the right edge
            const rightX = width - scrollStep;
            const numBins = Math.floor(dataArray.length * 0.55); // Top avian range
            const binHeight = height / numBins;

            for (let b = 0; b < numBins; b++) {
              const val = dataArray[b];
              offCtx.fillStyle = COLOR_LUT[val] || '#090d16';
              const y = height - (b + 1) * binHeight;
              offCtx.fillRect(rightX, Math.floor(y), scrollStep, Math.ceil(binHeight + 0.5));
            }
          } else if (isIdle) {
            // Subtle ambient sine indicator on idle
            offCtx.fillStyle = '#090d16';
            offCtx.fillRect(0, 0, width, height);

            const time = now * 0.002;
            offCtx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
            offCtx.lineWidth = 1;
            offCtx.beginPath();
            for (let x = startX; x < width; x += 3) {
              const y = height * 0.65 + Math.sin(x * 0.03 + time) * 8 + Math.sin(x * 0.08 - time * 1.5) * 4;
              if (x === startX) offCtx.moveTo(x, y);
              else offCtx.lineTo(x, y);
            }
            offCtx.stroke();
          }

          // Blit offscreen buffer to main display canvas
          ctx.drawImage(offscreen, 0, 0);
        }

        // Draw scale and grid overlay
        drawGridAndScale(ctx, width, height, startX, highlightDominantHz);
      } else {
        // Oscilloscope Waveform View
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, width, height);

        drawGridAndScale(ctx, width, height, startX, undefined);

        if (timeDomainArray) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#10b981';
          ctx.beginPath();

          const plotWidth = width - startX;
          const sliceWidth = plotWidth / timeDomainArray.length;
          let x = startX;

          for (let i = 0; i < timeDomainArray.length; i++) {
            const v = (timeDomainArray[i] - 128) / 128.0;
            const y = height / 2 + v * (height * 0.42);

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);

            x += sliceWidth;
          }
          ctx.stroke();
        }
      }

      animFrameIdRef.current = requestAnimationFrame(render);
    };

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [isActive, viewMode, analyserNode, dimensions, highlightDominantHz]);

  const drawGridAndScale = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    startX: number,
    targetHz?: number
  ) => {
    // Frequency scale left sidebar background
    ctx.fillStyle = 'rgba(9, 13, 22, 0.92)';
    ctx.fillRect(0, 0, startX, height);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;

    // Axis divider line
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX, height);
    ctx.stroke();

    const freqMarkers = [
      { label: '8k', y: 0.15 },
      { label: '6k', y: 0.35 },
      { label: '4k', y: 0.55 },
      { label: '2k', y: 0.75 },
      { label: '500', y: 0.92 },
    ];

    ctx.fillStyle = '#64748b';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';

    freqMarkers.forEach((m) => {
      const y = Math.floor(m.y * height);
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.fillText(m.label, startX - 4, y + 3);
    });

    // Dominant target frequency guideline
    if (targetHz && targetHz >= 500 && targetHz <= 10000) {
      const normY = 1 - Math.min(9500, targetHz) / 10000;
      const y = Math.floor(normY * height);

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.75)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#10b981';
      ctx.textAlign = 'left';
      ctx.fillText(`Target: ${targetHz} Hz`, startX + 8, y - 4);
    }
  };

  const handleCaptureSnapshot = useCallback(() => {
    if (canvasRef.current && onSnapshot) {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      onSnapshot(dataUrl);
    }
  }, [onSnapshot]);

  const handleClearWaterfall = () => {
    if (offscreenCanvasRef.current) {
      const ctx = offscreenCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, dimensions.width, dimensions.height);
      }
    }
  };

  return (
    <div className={`relative rounded-2xl border p-4 shadow-sm overflow-hidden transition-colors ${
      isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-slate-50 border-slate-200'
    }`}>
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 mb-3 border-b border-slate-200 dark:border-slate-800 text-xs gap-2">
        <div className="flex items-center gap-2.5">
          <div className={`flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-semibold ${
            isActive
              ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
              : isDark
              ? 'bg-slate-800 text-slate-400 border border-slate-700'
              : 'bg-slate-200 text-slate-600 border border-slate-300'
          }`}>
            <span
              className={`w-2 h-2 rounded-full ${
                isActive
                  ? 'bg-emerald-500 shadow-sm shadow-emerald-500 animate-pulse'
                  : 'bg-slate-400'
              }`}
            />
            <span>{isActive ? 'Audio Live Stream' : 'Acoustic Standby'}</span>
          </div>
          {label && (
            <span className={`text-xs font-medium truncate max-w-[220px] ${
              isDark ? 'text-slate-300' : 'text-slate-600'
            }`}>
              {label}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 self-end sm:self-auto">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs ${
            isDark ? 'bg-slate-800/80 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-700 shadow-sm'
          }`}>
            <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Dominant Peak:</span>
            <span className="text-emerald-500 font-bold">{currentPeakHz} Hz</span>
          </div>

          <div className={`flex rounded-lg border p-0.5 ${
            isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-200 border-slate-300'
          }`}>
            <button
              type="button"
              onClick={() => setViewMode('spectrogram')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                viewMode === 'spectrogram'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Spectrogram</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('waveform')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                viewMode === 'waveform'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Waveform</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleClearWaterfall}
            title="Reset Waterfall Buffer"
            className={`p-1.5 rounded-lg transition-colors border ${
              isDark
                ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border-transparent hover:border-slate-700'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100 border-transparent hover:border-slate-200'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {onSnapshot && (
            <button
              type="button"
              onClick={handleCaptureSnapshot}
              title="Save Spectrogram Snapshot"
              className={`p-1.5 rounded-lg transition-colors border ${
                isDark
                  ? 'text-slate-400 hover:text-emerald-400 hover:bg-slate-800 border-transparent hover:border-slate-700'
                  : 'text-slate-500 hover:text-emerald-600 hover:bg-slate-100 border-transparent hover:border-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Canvas Container with ResizeObserver */}
      <div
        ref={containerRef}
        className="relative w-full h-44 sm:h-52 bg-[#090d16] rounded-xl overflow-hidden border border-black/40 shadow-inner"
      >
        <canvas ref={canvasRef} className="w-full h-full block" />

        {/* Legend Overlay */}
        <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/80 backdrop-blur-sm border border-white/10 text-[10px] text-slate-300 font-mono tracking-wider pointer-events-none">
          <Volume2 className="w-3 h-3 text-emerald-400" />
          <span>STFT Mel-128 • 44.1 kHz</span>
        </div>
      </div>
    </div>
  );
};
