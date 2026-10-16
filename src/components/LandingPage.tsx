import React, { useState, useEffect, useRef } from 'react';
import {
  Waves,
  Feather,
  Compass,
  FileSpreadsheet,
  Mic,
  Upload,
  Sparkles,
  Activity,
  TreePine,
  ShieldAlert,
  ArrowRight,
  Play,
  Square,
  Volume2,
  CheckCircle2,
  TrendingUp,
  MapPin,
  Globe,
  Sliders,
  BarChart3,
  Award,
  Layers,
  BookOpen,
  Info,
} from 'lucide-react';
import { BirdSpecies, IUCNStatus } from '../types';
import { BIRD_SPECIES } from '../data/birds';
import { playBirdCall } from '../utils/audioSynth';

export interface LandingPageProps {
  onNavigate: (tab: 'classifier' | 'catalog' | 'dashboard' | 'observations' | 'log') => void;
  onSelectSampleForClassification: (species: BirdSpecies) => void;
  speciesCount: number;
  observationCount: number;
  shannonIndex: number;
  ecosystemHealth: 'Healthy' | 'Moderate' | 'Under Stress' | string;
  theme?: 'dark' | 'light';
  onPlayToggle?: (species: BirdSpecies) => void;
  activePlayingId?: string | null;
}

// Accurate species-specific images are served from /images/birds/${species.id}.jpg
const DEFAULT_BIRD_IMAGE = '/images/birds/pavo-cristatus.jpg';

// Helper functions for safe species data access
function getSpeciesImage(species: BirdSpecies): string {
  if (species.imageUrl && species.imageUrl.trim().length > 0) {
    return species.imageUrl;
  }
  return `/images/birds/${species.id}.jpg`;
}

function getFreqMin(species: BirdSpecies): number {
  if (Array.isArray(species.frequencyRange)) return species.frequencyRange[0];
  if (typeof species.frequencyRange === 'object' && species.frequencyRange && 'minHz' in species.frequencyRange) {
    return (species.frequencyRange as { minHz: number }).minHz;
  }
  return 1500;
}

function getFreqMax(species: BirdSpecies): number {
  if (Array.isArray(species.frequencyRange)) return species.frequencyRange[1];
  if (typeof species.frequencyRange === 'object' && species.frequencyRange && 'maxHz' in species.frequencyRange) {
    return (species.frequencyRange as { maxHz: number }).maxHz;
  }
  return 6000;
}

function getPeakHz(species: BirdSpecies): number {
  if (typeof species.peakFrequencyHz === 'number') return species.peakFrequencyHz;
  if (typeof species.frequencyRange === 'object' && species.frequencyRange && 'dominantHz' in species.frequencyRange) {
    return (species.frequencyRange as { dominantHz: number }).dominantHz;
  }
  return 3000;
}

function getIucnLabel(status: string): string {
  const labels: Record<string, string> = {
    LC: 'Least Concern',
    NT: 'Near Threatened',
    VU: 'Vulnerable',
    EN: 'Endangered',
    CR: 'Critically Endangered',
  };
  return labels[status] || 'Least Concern';
}

function getSensitivityScore(species: BirdSpecies): number {
  if (typeof species.sensitivityScore === 'number') return species.sensitivityScore;
  if (species.bioindicatorSensitivity === 'High') return 8;
  if (species.bioindicatorSensitivity === 'Moderate') return 5;
  return 3;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onNavigate,
  onSelectSampleForClassification,
  speciesCount,
  observationCount,
  shannonIndex,
  ecosystemHealth,
  theme = 'dark',
  onPlayToggle,
  activePlayingId,
}) => {
  const isDark = theme === 'dark';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Local audio playback state fallback
  const [localPlayingId, setLocalPlayingId] = useState<string | null>(null);
  const localStopFnRef = useRef<(() => void) | null>(null);

  const currentPlayingId = activePlayingId !== undefined ? activePlayingId : localPlayingId;

  // Find 6 featured species from BIRD_SPECIES
  const featuredBirds = React.useMemo(() => {
    const candidateIds = [
      'pavo-cristatus',
      'eudynamys-scolopaceus',
      'copsychus-saularis',
      'turdus-migratorius',
      'cardinalis-cardinalis',
      'tyto-alba',
      'poecile-atricapillus',
      'bubo-virginianus',
      'zenaida-macroura',
    ];
    const found: BirdSpecies[] = [];
    for (const id of candidateIds) {
      const match = BIRD_SPECIES.find((b) => b.id === id);
      if (match && !found.some((b) => b.id === match.id)) {
        found.push(match);
      }
      if (found.length >= 6) break;
    }
    // Fallback if needed
    if (found.length < 6) {
      for (const b of BIRD_SPECIES) {
        if (!found.some((x) => x.id === b.id)) {
          found.push(b);
        }
        if (found.length >= 6) break;
      }
    }
    return found;
  }, []);

  const [selectedDemoBirdId, setSelectedDemoBirdId] = useState<string>(() => {
    return featuredBirds[0]?.id || (BIRD_SPECIES[0]?.id ?? '');
  });

  const demoBird = featuredBirds.find((b) => b.id === selectedDemoBirdId) || featuredBirds[0] || BIRD_SPECIES[0];
  const isDemoPlaying = currentPlayingId === demoBird?.id;

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (localStopFnRef.current) {
        localStopFnRef.current();
        localStopFnRef.current = null;
      }
    };
  }, []);

  const handlePlayToggle = async (species: BirdSpecies) => {
    if (onPlayToggle) {
      onPlayToggle(species);
      return;
    }

    if (localPlayingId === species.id) {
      if (localStopFnRef.current) {
        localStopFnRef.current();
        localStopFnRef.current = null;
      }
      setLocalPlayingId(null);
    } else {
      if (localStopFnRef.current) {
        localStopFnRef.current();
        localStopFnRef.current = null;
      }
      try {
        const stopFn = await playBirdCall(species, 2.5);
        localStopFnRef.current = stopFn;
        setLocalPlayingId(species.id);

        setTimeout(() => {
          setLocalPlayingId((curr) => (curr === species.id ? null : curr));
        }, 2500);
      } catch (err) {
        console.warn('Audio playback error:', err);
      }
    }
  };

  // Spectrogram / Waveform Canvas Animation for Hero Background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let time = 0;
    const resizeCanvas = () => {
      canvas.width = canvas.parentElement?.clientWidth || 1000;
      canvas.height = 360;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const render = () => {
      time += 0.02;
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      // Draw faint frequency grid lines
      ctx.strokeStyle = isDark ? 'rgba(51, 65, 85, 0.3)' : 'rgba(203, 213, 225, 0.4)';
      ctx.lineWidth = 1;
      const numLines = 6;
      for (let i = 1; i <= numLines; i++) {
        const y = (height / (numLines + 1)) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw simulated Mel-spectrogram frequency heat ribbons
      const numBands = 28;
      const bandWidth = width / numBands;

      for (let i = 0; i < numBands; i++) {
        const x = i * bandWidth;
        const baseH = Math.sin(i * 0.4 + time * 1.5) * 0.5 + 0.5;
        const chirpH = Math.sin(i * 0.8 - time * 2.2) * 0.5 + 0.5;
        const warbleH = Math.cos(i * 1.2 + time) * 0.5 + 0.5;

        const amp = (baseH * 0.4 + chirpH * 0.4 + warbleH * 0.2);
        const barHeight = height * 0.7 * amp;
        const y = height * 0.85 - barHeight;

        const gradient = ctx.createLinearGradient(0, height * 0.85, 0, y);
        if (isDark) {
          gradient.addColorStop(0, 'rgba(16, 185, 129, 0.05)');
          gradient.addColorStop(0.5, 'rgba(20, 184, 166, 0.25)');
          gradient.addColorStop(0.85, 'rgba(56, 189, 248, 0.45)');
          gradient.addColorStop(1, 'rgba(251, 191, 36, 0.6)');
        } else {
          gradient.addColorStop(0, 'rgba(16, 185, 129, 0.08)');
          gradient.addColorStop(0.5, 'rgba(13, 148, 136, 0.2)');
          gradient.addColorStop(0.85, 'rgba(2, 132, 199, 0.35)');
          gradient.addColorStop(1, 'rgba(217, 119, 6, 0.5)');
        }

        ctx.fillStyle = gradient;
        ctx.fillRect(x + 2, y, bandWidth - 4, barHeight);

        ctx.fillStyle = isDark ? '#34d399' : '#059669';
        ctx.beginPath();
        ctx.arc(x + bandWidth / 2, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Smooth overlaid audio envelope curve
      ctx.beginPath();
      ctx.strokeStyle = isDark ? 'rgba(52, 211, 153, 0.75)' : 'rgba(5, 150, 105, 0.8)';
      ctx.lineWidth = 2.5;

      for (let x = 0; x <= width; x += 10) {
        const normX = x / width;
        const curve =
          Math.sin(normX * 12 + time * 3) * 20 * Math.sin(normX * Math.PI) +
          Math.cos(normX * 24 - time * 4) * 12 * Math.sin(normX * Math.PI);
        const y = height * 0.55 + curve;

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isDark]);

  // Determine health color badge
  const isHealthy =
    ecosystemHealth === 'Healthy' || ecosystemHealth === 'Optimal' || ecosystemHealth === 'Stable';
  const isModerate =
    ecosystemHealth === 'Moderate' || ecosystemHealth === 'Vulnerable';

  return (
    <div className="space-y-16 pb-16">
      {/* ========================================================
          1. HERO SECTION WITH SPECTROGRAM VISUALIZER
          ======================================================== */}
      <section className="relative overflow-hidden rounded-3xl border border-emerald-500/20 shadow-xl transition-all duration-300">
        {/* Background Visualizer & Ambient Glow */}
        <div className={`absolute inset-0 pointer-events-none transition-colors duration-300 ${
          isDark
            ? 'bg-gradient-to-b from-[#0F172A] via-[#0B0F17] to-[#0A0D14]'
            : 'bg-gradient-to-b from-emerald-50/70 via-slate-50 to-white'
        }`}>
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full opacity-60 mix-blend-screen pointer-events-none"
          />
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute top-1/2 -right-24 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
        </div>

        {/* Hero Content */}
        <div className="relative z-10 max-w-5xl mx-auto px-6 sm:px-10 pt-12 sm:pt-16 pb-12 sm:pb-16 text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-wide border shadow-sm backdrop-blur-md transition-colors bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>AI BIOACOUSTIC ENVIRONMENTAL MONITORING</span>
          </div>

          <div className="space-y-4 max-w-4xl mx-auto">
            <div className="text-xs uppercase tracking-widest font-mono text-emerald-400 font-semibold">
              BIRDSONG BIOACOUSTICS
            </div>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black font-display tracking-tight leading-[1.15] text-white">
              Welcome to <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">BirdSong</span>
            </h1>

            <p className={`text-base sm:text-xl font-medium tracking-tight ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
              AI-Based Bird Species Recognition & Ecosystem Health Monitoring
            </p>

            <p className="text-sm sm:text-base font-semibold max-w-2xl mx-auto italic text-emerald-400">
              "Listen to nature. Identify bird species. Understand ecosystem health."
            </p>

            <p className={`text-xs sm:text-sm max-w-3xl mx-auto leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              BirdSong uses AI-powered bioacoustic analysis to identify bird species from their calls and analyze changes in bird activity and diversity as indicators of ecosystem health.
            </p>

            <div className="inline-block px-4 py-2 rounded-xl border text-xs font-medium backdrop-blur-sm bg-slate-900/60 border-slate-800 text-slate-300">
              Turn environmental sounds into meaningful biodiversity insights.
            </div>
          </div>

          {/* Call-to-action buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
            <button
              type="button"
              onClick={() => onNavigate('classifier')}
              className="w-full sm:w-auto px-7 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm tracking-wide shadow-lg shadow-emerald-600/30 hover:shadow-emerald-600/50 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2.5 cursor-pointer"
            >
              <Waves className="w-4 h-4" />
              <span>Start BirdSong Analysis</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('catalog')}
              className="w-full sm:w-auto px-6 py-3.5 rounded-2xl border font-semibold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer bg-slate-900/80 hover:bg-slate-800 text-slate-200 border-slate-700 hover:border-slate-600"
            >
              <Feather className="w-4 h-4 text-emerald-400" />
              <span>Explore Species</span>
            </button>
          </div>

          {/* Spectrogram frequency ruler banner */}
          <div className="pt-6 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs font-mono text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              STFT Mel-Scale Analysis: 512–11025 Hz
            </span>
            <span>FFT Window: 2048 pts</span>
            <span>Shannon H' Bioindicator Engine</span>
            <span>{speciesCount} Avian Taxa Calibrated</span>
          </div>
        </div>
      </section>

      {/* ========================================================
          2. LIVE SYSTEM STATISTICS (Real values from state)
          ======================================================== */}
      <section>
        <div className="p-6 rounded-2xl border shadow-sm bg-[#111827]/90 border-slate-800/90">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-white">
                Live Bioacoustic System Statistics
              </h3>
            </div>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
              Synchronized
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Stat 1: Species in Library */}
            <div className="p-4 rounded-xl border bg-slate-900/60 border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                  Species in Library
                </span>
                <Feather className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-3xl font-black font-display text-emerald-400">
                {speciesCount}
              </p>
              <p className="text-xs mt-0.5 text-slate-400">
                Avian taxa with acoustic profiles
              </p>
            </div>

            {/* Stat 2: Observations count */}
            <div className="p-4 rounded-xl border bg-slate-900/60 border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                  Observations
                </span>
                <FileSpreadsheet className="w-4 h-4 text-teal-400" />
              </div>
              <p className="text-3xl font-black font-display text-white">
                {observationCount}
              </p>
              <p className="text-xs mt-0.5 text-slate-400">
                Detections in observation log
              </p>
            </div>

            {/* Stat 3: Shannon Diversity index */}
            <div className="p-4 rounded-xl border bg-slate-900/60 border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                  Shannon Diversity (H')
                </span>
                <TreePine className="w-4 h-4 text-amber-400" />
              </div>
              <p className="text-3xl font-black font-display text-amber-400">
                {typeof shannonIndex === 'number' ? shannonIndex.toFixed(2) : '0.00'}
              </p>
              <p className="text-xs mt-0.5 text-slate-400">
                Bioacoustic community balance
              </p>
            </div>

            {/* Stat 4: Ecosystem Health Indicator */}
            <div className="p-4 rounded-xl border bg-slate-900/60 border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                  Ecosystem Health
                </span>
                <Compass className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`w-3 h-3 rounded-full ${
                  isHealthy
                    ? 'bg-emerald-500 animate-pulse'
                    : isModerate
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
                }`} />
                <p className={`text-2xl font-black font-display ${
                  isHealthy
                    ? 'text-emerald-400'
                    : isModerate
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}>
                  {ecosystemHealth}
                </p>
              </div>
              <p className="text-xs mt-0.5 text-slate-400">
                Based on active acoustic records
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================
          3. INTERACTIVE AUDIO EXPERIENCE: "Listen to the Ecosystem"
          ======================================================== */}
      {demoBird && (
        <section className="p-6 sm:p-8 rounded-3xl border shadow-sm transition-all bg-[#111827]/90 border-slate-800/90">
          <div className="max-w-3xl mx-auto text-center space-y-2 mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Volume2 className="w-3.5 h-3.5" />
              <span>INTERACTIVE AUDIO DEMO</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold font-display tracking-tight text-white">
              Listen to the Ecosystem
            </h2>
            <p className="text-xs sm:text-sm text-slate-300">
              Experience authentic avian vocalizations. Test playback to inspect acoustic frequency bands, harmonics, and vocal patterns.
            </p>
          </div>

          {/* Species Switcher Chips */}
          <div className="flex items-center justify-center gap-2 flex-wrap mb-6">
            {featuredBirds.map((bird) => {
              const isSelected = selectedDemoBirdId === bird.id;
              return (
                <button
                  key={bird.id}
                  type="button"
                  onClick={() => setSelectedDemoBirdId(bird.id)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-600/20 scale-105'
                      : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {bird.commonName}
                </button>
              );
            })}
          </div>

          {/* Interactive Bird Call Card */}
          <div className="p-6 rounded-2xl border transition-all bg-slate-900/70 border-slate-800">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              {/* Left: Thumbnail & Info */}
              <div className="flex items-center gap-4 w-full md:w-auto">
                <img
                  src={getSpeciesImage(demoBird)}
                  alt={demoBird.commonName}
                  onError={(e) => {
                    e.currentTarget.src = DEFAULT_BIRD_IMAGE;
                  }}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover shadow-md border border-slate-700/50 shrink-0"
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold font-display text-white">
                      {demoBird.commonName}
                    </h3>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      demoBird.iucnStatus === 'VU'
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        : demoBird.iucnStatus === 'NT'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}>
                      {demoBird.iucnStatus} &bull; {getIucnLabel(demoBird.iucnStatus)}
                    </span>
                  </div>
                  <p className="text-xs italic text-slate-400">
                    {demoBird.scientificName} &bull; {demoBird.family}
                  </p>
                  <p className="text-xs line-clamp-2 max-w-md text-slate-300">
                    {demoBird.sampleAudioDesc || demoBird.description}
                  </p>
                </div>
              </div>

              {/* Right: Audio Playback Trigger & Real-time Visualizer */}
              <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => handlePlayToggle(demoBird)}
                  className={`px-5 py-3 rounded-2xl font-bold text-xs tracking-wide shadow-md flex items-center gap-2 transition-all cursor-pointer ${
                    isDemoPlaying
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30 animate-pulse'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20 hover:scale-105'
                  }`}
                >
                  {isDemoPlaying ? (
                    <>
                      <Square className="w-4 h-4 fill-current" />
                      <span>Stop Call</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      <span>Play Bird Call</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => onSelectSampleForClassification(demoBird)}
                  className="px-4 py-3 rounded-2xl border text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer bg-slate-800/80 hover:bg-slate-800 text-slate-200 border-slate-700"
                >
                  <Waves className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Classify this Call</span>
                </button>
              </div>
            </div>

            {/* Animated Frequency & Waveform Status Banner */}
            <div className={`mt-5 p-4 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs ${
              isDemoPlaying
                ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-900/90 border-slate-800 text-slate-400'
            }`}>
              <div className="flex items-center gap-3">
                {isDemoPlaying ? (
                  <div className="flex items-center gap-1">
                    <span className="w-1 h-3 bg-emerald-500 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1 h-5 bg-emerald-500 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1 h-4 bg-emerald-500 rounded-full animate-bounce [animation-delay:300ms]" />
                    <span className="w-1 h-6 bg-emerald-500 rounded-full animate-bounce [animation-delay:450ms]" />
                  </div>
                ) : (
                  <Volume2 className="w-4 h-4 text-slate-400" />
                )}
                <span className="font-semibold">
                  {isDemoPlaying ? 'Analyzing acoustic signal in real-time...' : 'Audio engine ready. Click play to listen.'}
                </span>
              </div>

              <div className="flex items-center gap-4 text-[11px] font-mono">
                <span>Peak: <strong>{getPeakHz(demoBird)} Hz</strong></span>
                <span>Bandwidth: <strong>{getFreqMin(demoBird)}–{getFreqMax(demoBird)} Hz</strong></span>
                <span>Sensitivity: <strong>{getSensitivityScore(demoBird)}/10</strong></span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ========================================================
          4. HOW BIRDSONG WORKS (5-Step Process)
          ======================================================== */}
      <section className="space-y-6">
        <div className="text-center space-y-2 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Layers className="w-3.5 h-3.5" />
            <span>BIOACOUSTIC PIPELINE</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold font-display tracking-tight text-white">
            How BirdSong Works
          </h2>
          <p className="text-xs sm:text-sm text-slate-300">
            From environmental soundscapes to calibrated species classification and biodiversity indicators.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* Step 01 */}
          <div className="p-5 rounded-2xl border transition-all hover:scale-[1.02] shadow-sm flex flex-col justify-between bg-[#111827]/90 border-slate-800">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-emerald-400 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                  01
                </span>
                <Mic className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">
                Record / Upload
              </h3>
              <p className="text-xs leading-relaxed text-slate-400">
                Capture a bird call or environmental audio using field microphone or upload WAV, MP3, OGG, or M4A files.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800/40 text-[10px] text-emerald-400 font-mono font-semibold">
              STEP 1 OF 5
            </div>
          </div>

          {/* Step 02 */}
          <div className="p-5 rounded-2xl border transition-all hover:scale-[1.02] shadow-sm flex flex-col justify-between bg-[#111827]/90 border-slate-800">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-teal-400 px-2 py-0.5 rounded-md bg-teal-500/10 border border-teal-500/20">
                  02
                </span>
                <Waves className="w-5 h-5 text-teal-400" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">
                Acoustic Processing
              </h3>
              <p className="text-xs leading-relaxed text-slate-400">
                Convert raw audio signals into an STFT Mel-Spectrogram, isolating frequency bands, SNR, and harmonic peaks.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800/40 text-[10px] text-teal-400 font-mono font-semibold">
              STEP 2 OF 5
            </div>
          </div>

          {/* Step 03 */}
          <div className="p-5 rounded-2xl border transition-all hover:scale-[1.02] shadow-sm flex flex-col justify-between bg-[#111827]/90 border-slate-800">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-cyan-400 px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20">
                  03
                </span>
                <Sparkles className="w-5 h-5 text-cyan-400" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">
                AI Recognition
              </h3>
              <p className="text-xs leading-relaxed text-slate-400">
                Bioacoustic neural classifier analyzes acoustic patterns, syllables per second, and frequency curves.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800/40 text-[10px] text-cyan-400 font-mono font-semibold">
              STEP 3 OF 5
            </div>
          </div>

          {/* Step 04 */}
          <div className="p-5 rounded-2xl border transition-all hover:scale-[1.02] shadow-sm flex flex-col justify-between bg-[#111827]/90 border-slate-800">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-emerald-400 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                  04
                </span>
                <Feather className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">
                Species Identification
              </h3>
              <p className="text-xs leading-relaxed text-slate-400">
                Identify the most likely bird species, calculate confidence percentages, and list ranked candidates.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800/40 text-[10px] text-emerald-400 font-mono font-semibold">
              STEP 4 OF 5
            </div>
          </div>

          {/* Step 05 */}
          <div className="p-5 rounded-2xl border transition-all hover:scale-[1.02] shadow-sm flex flex-col justify-between bg-[#111827]/90 border-slate-800">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-amber-400 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20">
                  05
                </span>
                <TreePine className="w-5 h-5 text-amber-400" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">
                Ecosystem Insights
              </h3>
              <p className="text-xs leading-relaxed text-slate-400">
                Aggregate observations into Shannon diversity metrics, evenness scores, and ecosystem health indicators.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800/40 text-[10px] text-amber-400 font-mono font-semibold">
              STEP 5 OF 5
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================
          5. PLATFORM CAPABILITIES ("What Can BirdSong Do?")
          ======================================================== */}
      <section className="space-y-6">
        <div className="text-center space-y-2 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Award className="w-3.5 h-3.5" />
            <span>PLATFORM CAPABILITIES</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold font-display tracking-tight text-white">
            What Can BirdSong Do?
          </h2>
          <p className="text-xs sm:text-sm text-slate-300">
            Explore the specialized bioacoustic toolset engineered into BirdSong.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl border transition-all hover:border-emerald-500/40 bg-[#111827]/90 border-slate-800">
            <div className="flex items-center gap-3 mb-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                <Mic className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">Audio Recording</h3>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Record bird calls in real time using your microphone with live waveform monitoring.
            </p>
          </div>

          <div className="p-5 rounded-2xl border transition-all hover:border-emerald-500/40 bg-[#111827]/90 border-slate-800">
            <div className="flex items-center gap-3 mb-2.5">
              <div className="w-9 h-9 rounded-xl bg-teal-500/10 text-teal-400 flex items-center justify-center border border-teal-500/20">
                <Upload className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">Audio Upload</h3>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Upload environmental audio files (WAV, MP3, OGG, WebM, M4A) for rapid bioacoustic analysis.
            </p>
          </div>

          <div className="p-5 rounded-2xl border transition-all hover:border-emerald-500/40 bg-[#111827]/90 border-slate-800">
            <div className="flex items-center gap-3 mb-2.5">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/20">
                <Waves className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">Spectrogram Analysis</h3>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Visualize frequency patterns, harmonic sweeps, and dominant Hz in dynamic multi-color spectrograms.
            </p>
          </div>

          <div className="p-5 rounded-2xl border transition-all hover:border-emerald-500/40 bg-[#111827]/90 border-slate-800">
            <div className="flex items-center gap-3 mb-2.5">
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
                <Sparkles className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">AI Bird Recognition</h3>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Identify bird species from acoustic signals matched against curated reference profiles.
            </p>
          </div>

          <div className="p-5 rounded-2xl border transition-all hover:border-emerald-500/40 bg-[#111827]/90 border-slate-800">
            <div className="flex items-center gap-3 mb-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                <Activity className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">Confidence Analysis</h3>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Display percentage confidence rankings alongside alternate candidate taxa matches.
            </p>
          </div>

          <div className="p-5 rounded-2xl border transition-all hover:border-emerald-500/40 bg-[#111827]/90 border-slate-800">
            <div className="flex items-center gap-3 mb-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
                <Feather className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">Species Library</h3>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Explore information, conservation status, songs, and photos for species in the library.
            </p>
          </div>

          <div className="p-5 rounded-2xl border transition-all hover:border-emerald-500/40 bg-[#111827]/90 border-slate-800">
            <div className="flex items-center gap-3 mb-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                <TreePine className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">Ecosystem Health</h3>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Analyze biodiversity indicators with Shannon index (H') and Pielou's evenness (J').
            </p>
          </div>

          <div className="p-5 rounded-2xl border transition-all hover:border-emerald-500/40 bg-[#111827]/90 border-slate-800">
            <div className="flex items-center gap-3 mb-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
                <BarChart3 className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">Biodiversity Dashboard</h3>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Track vocalization frequency distribution, taxa abundance, and IUCN Red List tier charts.
            </p>
          </div>

          <div className="p-5 rounded-2xl border transition-all hover:border-emerald-500/40 bg-[#111827]/90 border-slate-800">
            <div className="flex items-center gap-3 mb-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">Observation Journal</h3>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Store and review previous observations with timestamps, confidence, notes, and CSV export.
            </p>
          </div>

          <div className="p-5 rounded-2xl border transition-all hover:border-emerald-500/40 sm:col-span-2 lg:col-span-3 bg-[#111827]/90 border-slate-800">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-teal-500/10 text-teal-400 flex items-center justify-center border border-teal-500/20">
                <MapPin className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold font-display text-white">Location Monitoring</h3>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Associate observations with designated field sectors, ecological monitoring stations, and habitat zones for spatial tracking.
            </p>
          </div>
        </div>
      </section>

      {/* ========================================================
          6. ECOSYSTEM HEALTH SECTION ("From Bird Calls to Ecosystem Insights")
          ======================================================== */}
      <section className="p-6 sm:p-8 rounded-3xl border shadow-sm bg-[#111827]/90 border-slate-800/90">
        <div className="max-w-3xl mx-auto text-center space-y-3 mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <TreePine className="w-3.5 h-3.5" />
            <span>BIOINDICATOR METRICS</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold font-display tracking-tight text-white">
            From Bird Calls to Ecosystem Insights
          </h2>
          <p className="text-xs sm:text-sm max-w-2xl mx-auto leading-relaxed text-slate-300">
            Birds are valuable ecological indicators. Changes in species diversity, activity, and vocalization patterns can provide useful signals for biodiversity monitoring.
          </p>

          <div className="p-3 rounded-xl border text-[11px] max-w-xl mx-auto text-center flex items-center gap-2 justify-center bg-slate-900/60 border-slate-800 text-slate-400">
            <Info className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>
              <strong>Ecosystem Health Indicator:</strong> An observational metric based on community diversity and vocalization activity; not a definitive scientific diagnosis.
            </span>
          </div>
        </div>

        {/* 3 Ecological Health Tiers */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="p-6 rounded-2xl border transition-all bg-emerald-950/20 border-emerald-500/30">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
              <h3 className="text-base font-bold font-display text-emerald-400">
                🟢 HEALTHY
              </h3>
            </div>
            <p className="text-xs font-semibold mb-2 text-slate-200">
              High species diversity and activity
            </p>
            <p className="text-xs leading-relaxed text-slate-400">
              Acoustic community exhibits high Shannon index (H' ≥ 2.0) and high evenness. Sensitive canopy and ground bioindicators thrive in layered, resilient habitats.
            </p>
          </div>

          <div className="p-6 rounded-2xl border transition-all bg-amber-950/20 border-amber-500/30">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-3 h-3 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50" />
              <h3 className="text-base font-bold font-display text-amber-400">
                🟡 MODERATE
              </h3>
            </div>
            <p className="text-xs font-semibold mb-2 text-slate-200">
              Moderate biodiversity / activity
            </p>
            <p className="text-xs leading-relaxed text-slate-400">
              Stable population of resilient generalist bird species with fewer sensitive bioindicators. Signals opportunities for corridor protection and habitat restoration.
            </p>
          </div>

          <div className="p-6 rounded-2xl border transition-all bg-rose-950/20 border-rose-500/30">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-3 h-3 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50" />
              <h3 className="text-base font-bold font-display text-rose-400">
                🔴 UNDER STRESS
              </h3>
            </div>
            <p className="text-xs font-semibold mb-2 text-slate-200">
              Reduced biodiversity / activity
            </p>
            <p className="text-xs leading-relaxed text-slate-400">
              Low Shannon index and monoculture vocalization dominance. Disappearance of sensitive indicator taxa suggests environmental disruption or habitat fragmentation.
            </p>
          </div>
        </div>
      </section>

      {/* ========================================================
          7. PROJECT IMPACT SECTION ("Why BirdSong?")
          ======================================================== */}
      <section className="space-y-6">
        <div className="text-center space-y-2 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Globe className="w-3.5 h-3.5" />
            <span>REAL-WORLD IMPACT</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold font-display tracking-tight text-white">
            Why BirdSong?
          </h2>
          <p className="text-xs sm:text-sm text-slate-300">
            Bridging bioacoustic science, machine learning, and ecological conservation.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="p-6 rounded-2xl border space-y-3 bg-slate-900/60 border-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 font-mono">
              THE ECOLOGICAL CHALLENGE
            </span>
            <h3 className="text-lg font-bold font-display text-white">
              Manual Field Monitoring is Hard
            </h3>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-300">
              "Monitoring bird populations manually across large forests and natural habitats is time-consuming and difficult."
            </p>
            <p className="text-xs leading-relaxed text-slate-400">
              Field ornithologists face dense foliage, shy canopy species, nocturnal foraging cycles, and vast geographic reserves where visual surveys capture only a fraction of avian presence.
            </p>
          </div>

          <div className="p-6 rounded-2xl border space-y-3 bg-emerald-950/20 border-emerald-500/30">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 font-mono">
              THE BIRDSONG SOLUTION
            </span>
            <h3 className="text-lg font-bold font-display text-white">
              Automated Bioacoustic Intelligence
            </h3>
            <p className="text-xs sm:text-sm leading-relaxed text-emerald-300 font-medium">
              "BirdSong automates acoustic observation by using AI to identify bird species from environmental recordings and organize observations for biodiversity monitoring."
            </p>
            <p className="text-xs leading-relaxed text-slate-400">
              Continuous passive acoustic recording extracts sound signatures in real time, translating natural soundscapes into actionable conservation telemetry.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl border shadow-sm bg-[#111827]/90 border-slate-800">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20 mb-3">
              <Globe className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold font-display mb-1 text-white">
              🌍 Biodiversity Monitoring
            </h3>
            <p className="text-xs leading-relaxed text-slate-400">
              Automated observation of bird species across diverse terrestrial and wetland ecosystems without habitat intrusion.
            </p>
          </div>

          <div className="p-5 rounded-2xl border shadow-sm bg-[#111827]/90 border-slate-800">
            <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-400 flex items-center justify-center border border-teal-500/20 mb-3">
              <BookOpen className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold font-display mb-1 text-white">
              🔬 Research Support
            </h3>
            <p className="text-xs leading-relaxed text-slate-400">
              Organize acoustic observations for ecological studies with exportable CSV telemetry and verified frequency metrics.
            </p>
          </div>

          <div className="p-5 rounded-2xl border shadow-sm bg-[#111827]/90 border-slate-800">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20 mb-3">
              <TreePine className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold font-display mb-1 text-white">
              🌳 Conservation Awareness
            </h3>
            <p className="text-xs leading-relaxed text-slate-400">
              Highlight changes in bird diversity and activity over time to support early environmental intervention and education.
            </p>
          </div>
        </div>
      </section>

      {/* ========================================================
          8. SPECIES PREVIEW ("Explore the Species Library")
          ======================================================== */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Feather className="w-3.5 h-3.5" />
              <span>AVIAN TAXA REPOSITORY</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold font-display tracking-tight text-white">
              Explore the Species Library
            </h2>
            <p className="text-xs sm:text-sm text-slate-300">
              Acoustic profiles, frequency envelopes, and conservation data from our {speciesCount}-species reference archive.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('catalog')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold transition-all self-start sm:self-auto cursor-pointer bg-slate-900/80 hover:bg-slate-800 text-emerald-400 border-slate-700"
          >
            <span>Explore All {speciesCount} Species</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 6 Bird Cards Preview Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {featuredBirds.map((bird) => {
            const isPlaying = currentPlayingId === bird.id;
            return (
              <div
                key={bird.id}
                className="rounded-2xl border overflow-hidden transition-all hover:scale-[1.01] hover:shadow-md flex flex-col justify-between bg-[#111827]/90 border-slate-800"
              >
                <div>
                  <div className="relative h-44 overflow-hidden bg-slate-900">
                    <img
                      src={getSpeciesImage(bird)}
                      alt={bird.commonName}
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_BIRD_IMAGE;
                      }}
                      className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
                    />
                    <div className="absolute top-2.5 right-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-md ${
                        bird.iucnStatus === 'VU'
                          ? 'bg-rose-500/90 text-white'
                          : bird.iucnStatus === 'NT'
                          ? 'bg-amber-500/90 text-white'
                          : 'bg-emerald-600/90 text-white'
                      }`}>
                        {bird.iucnStatus} &bull; {getIucnLabel(bird.iucnStatus)}
                      </span>
                    </div>

                    <div className="absolute bottom-2.5 left-2.5">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-medium bg-black/70 text-white/90 backdrop-blur-sm">
                        {getPeakHz(bird)} Hz Peak
                      </span>
                    </div>
                  </div>

                  <div className="p-4 space-y-2">
                    <div>
                      <h3 className="text-base font-bold font-display text-white">
                        {bird.commonName}
                      </h3>
                      <p className="text-xs italic text-slate-400">
                        {bird.scientificName} &bull; {bird.family}
                      </p>
                    </div>

                    <p className="text-xs line-clamp-2 text-slate-300">
                      {bird.bioindicatorRole || bird.description}
                    </p>
                  </div>
                </div>

                <div className="p-4 pt-0 flex items-center justify-between gap-2 border-t mt-2 border-slate-800">
                  <button
                    type="button"
                    onClick={() => handlePlayToggle(bird)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      isPlaying
                        ? 'bg-rose-600 text-white animate-pulse'
                        : 'bg-slate-800 hover:bg-slate-700 text-emerald-400'
                    }`}
                  >
                    {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                    <span>{isPlaying ? 'Stop' : 'Listen'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectSampleForClassification(bird)}
                    className="text-xs font-medium hover:underline flex items-center gap-1 cursor-pointer text-slate-400 hover:text-white"
                  >
                    <span>Analyze</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => onNavigate('catalog')}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl border text-xs font-bold transition-all cursor-pointer bg-slate-900/90 hover:bg-slate-800 text-emerald-400 border-slate-700"
          >
            <span>Explore {speciesCount} Species →</span>
          </button>
        </div>
      </section>

      {/* ========================================================
          9. FINAL CALL-TO-ACTION BANNER
          ======================================================== */}
      <section className="p-8 sm:p-12 rounded-3xl border text-center space-y-6 relative overflow-hidden shadow-lg bg-gradient-to-r from-emerald-950/40 via-slate-900 to-teal-950/40 border-emerald-500/30">
        <div className="max-w-2xl mx-auto space-y-3 relative z-10">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-md shadow-emerald-500/30">
            <Waves className="w-6 h-6" />
          </div>
          <h2 className="text-2xl sm:text-4xl font-bold font-display tracking-tight text-white">
            Ready to Analyze Bird Vocalizations?
          </h2>
          <p className="text-xs sm:text-base leading-relaxed text-slate-300">
            Capture field recordings with your microphone, upload environmental audio files, or test reference benchmarks from our library.
          </p>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3.5">
            <button
              type="button"
              onClick={() => onNavigate('classifier')}
              className="w-full sm:w-auto px-7 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm tracking-wide shadow-lg shadow-emerald-600/30 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Mic className="w-4 h-4" />
              <span>Launch Bioacoustic Classifier</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="w-full sm:w-auto px-6 py-3.5 rounded-2xl border font-semibold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer bg-slate-900/80 hover:bg-slate-800 text-slate-200 border-slate-700"
            >
              <Compass className="w-4 h-4 text-emerald-400" />
              <span>View Biodiversity Health</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
