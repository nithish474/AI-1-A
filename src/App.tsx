import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Home,
  Radio,
  BookOpen,
  ClipboardList,
  BarChart3,
  Layers,
  Database,
  RefreshCw,
} from 'lucide-react';
import { Observation, BirdSpecies } from './types';
import { BIRD_SPECIES } from './data/birds';
import { calculateBiodiversityMetrics, getInitialObservations } from './utils/biodiversityMetrics';
import { AudioClassifier, ObservationPayload } from './components/AudioClassifier';
import { SpeciesCatalog } from './components/SpeciesCatalog';
import { ObservationLog } from './components/ObservationLog';
import { EcosystemDashboard } from './components/EcosystemDashboard';
import { LandingPage } from './components/LandingPage';
import { DatasetManager } from './components/DatasetManager';
import { ErrorBoundary } from './components/ErrorBoundary';

type ActiveTab = 'home' | 'classifier' | 'catalog' | 'observations' | 'dashboard' | 'dataset';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [preselectedSpeciesId, setPreselectedSpeciesId] = useState<string | null>(null);

  const [speciesList, setSpeciesList] = useState<BirdSpecies[]>(BIRD_SPECIES);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [isLoadingObs, setIsLoadingObs] = useState<boolean>(true);

  // Suppress benign ResizeObserver loop notification messages
  useEffect(() => {
    const handleResizeObserverError = (e: ErrorEvent) => {
      if (
        e.message?.includes('ResizeObserver loop') ||
        e.message?.includes('undelivered notifications')
      ) {
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('error', handleResizeObserverError);
    return () => window.removeEventListener('error', handleResizeObserverError);
  }, []);

  // Fetch species catalog from backend
  const fetchSpecies = useCallback(async () => {
    try {
      const res = await fetch('/api/species');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setSpeciesList(data);
        }
      }
    } catch (err) {
      console.warn('Species catalog loaded from local defaults:', err);
    }
  }, []);

  // Fetch observations from backend
  const fetchObservations = useCallback(async () => {
    setIsLoadingObs(true);
    try {
      const res = await fetch('/api/observations');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setObservations(data);
        }
      }
    } catch (err) {
      console.warn('Observations loaded from local defaults:', err);
    } finally {
      setIsLoadingObs(false);
    }
  }, []);

  useEffect(() => {
    fetchSpecies();
    fetchObservations();
  }, [fetchSpecies, fetchObservations]);

  // Handler to add persistent observation from classifier
  const handleAddObservation = async (payload: ObservationPayload) => {
    try {
      const res = await fetch('/api/observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const saved = await res.json();
        setObservations((prev) => {
          const withoutDemo = prev.filter(
            (o) => !o.isDemo && !o.id.startsWith('obs-seed-') && !o.id.startsWith('seed-obs-')
          );
          const withoutSaved = withoutDemo.filter((o) => o.id !== saved.id);
          return [saved, ...withoutSaved];
        });
        await fetchObservations();
      } else {
        // Optimistic fallback if network is offline
        const fallbackObs: Observation = {
          id: `obs-${Date.now()}`,
          speciesId: payload.speciesId,
          timestamp: new Date().toISOString(),
          location: payload.location || 'Field Station',
          latitude: payload.latitude,
          longitude: payload.longitude,
          confidence: payload.confidence,
          notes: payload.notes,
          source: 'classifier',
          audioSource: payload.audioSource || 'sample',
          durationSeconds: payload.durationSeconds,
          callsDetected: payload.callsDetected,
          callsPerMinute: payload.callsPerMinute,
          activityLevel: payload.activityLevel,
          activityUnavailableReason: payload.activityUnavailableReason,
          peakFrequencyHz: payload.peakFrequencyHz,
        };
        setObservations((prev) => [fallbackObs, ...prev]);
      }
    } catch (err) {
      console.error('Error posting observation to backend:', err);
    }
  };

  // Handler to delete observation
  const handleDeleteObservation = async (id: string) => {
    try {
      const res = await fetch(`/api/observations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setObservations((prev) => prev.filter((o) => o.id !== id));
        fetchObservations();
      } else {
        setObservations((prev) => prev.filter((o) => o.id !== id));
      }
    } catch (err) {
      console.error('Error deleting observation:', err);
      setObservations((prev) => prev.filter((o) => o.id !== id));
    }
  };

  const handleSelectSpeciesForTest = (speciesId: string) => {
    setPreselectedSpeciesId(speciesId);
    setActiveTab('classifier');
  };

  // Real-time biodiversity indicators calculated from active observations
  const metrics = useMemo(
    () => calculateBiodiversityMetrics(observations),
    [observations]
  );

  return (
    <div className="min-h-screen bg-[#070b11] text-[#E6EDF3] flex flex-col selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Top Application Header */}
      <header className="sticky top-0 z-40 bg-[#090e17]/90 backdrop-blur-md border-b border-emerald-500/20 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-24 flex items-center justify-between py-2">
          {/* Logo & App Name - Clickable to return Home */}
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-3 text-left group cursor-pointer focus:outline-none"
          >
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-sm group-hover:scale-105 transition-transform">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-white tracking-tight group-hover:text-emerald-300 transition-colors">
                  BirdSong Bioacoustics
                </h1>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30">
                  SQLite & Gemini Multimodal
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Avian Soundscape Analysis & Biodiversity Monitoring
              </p>
            </div>
          </button>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 sm:gap-1.5 bg-slate-900/90 p-1 rounded-xl border border-emerald-500/20">
            <button
              id="nav-tab-home"
              onClick={() => setActiveTab('home')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'home'
                  ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-800'
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              <span>Home</span>
            </button>

            <button
              id="nav-tab-classifier"
              onClick={() => setActiveTab('classifier')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'classifier'
                  ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-800'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Classifier</span>
            </button>

            <button
              id="nav-tab-catalog"
              onClick={() => setActiveTab('catalog')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'catalog'
                  ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-800'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Catalog</span>
            </button>

            <button
              id="nav-tab-observations"
              onClick={() => setActiveTab('observations')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'observations'
                  ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-800'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>Observations</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-800 text-emerald-300 border border-emerald-500/20">
                {observations.length}
              </span>
            </button>

            <button
              id="nav-tab-dashboard"
              onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-800'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Ecosystem Health</span>
            </button>

            <button
              id="nav-tab-dataset"
              onClick={() => setActiveTab('dataset')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'dataset'
                  ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-800'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Dataset & Model</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Area Protected by Error Boundaries (Prompt 11) */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'home' && (
          <ErrorBoundary viewName="Home / Landing Page">
            <LandingPage
              onNavigate={(tab) => {
                if (tab === 'log') {
                  setActiveTab('observations');
                } else {
                  setActiveTab(tab);
                }
              }}
              onSelectSampleForClassification={(species) => {
                setPreselectedSpeciesId(species.id);
                setActiveTab('classifier');
              }}
              speciesCount={speciesList.length}
              observationCount={observations.length}
              shannonIndex={metrics.shannonWienerIndex}
              ecosystemHealth={
                metrics.ecosystemHealth === 'Optimal' || metrics.ecosystemHealth === 'Stable'
                  ? 'Healthy'
                  : metrics.ecosystemHealth === 'Vulnerable'
                  ? 'Moderate'
                  : 'Under Stress'
              }
              theme="dark"
            />
          </ErrorBoundary>
        )}

        {activeTab === 'classifier' && (
          <ErrorBoundary viewName="Bioacoustic Classifier">
            <AudioClassifier
              onAddObservation={handleAddObservation}
              preselectedSpeciesId={preselectedSpeciesId}
              onClearPreselected={() => setPreselectedSpeciesId(null)}
              onNavigateToLog={() => setActiveTab('observations')}
            />
          </ErrorBoundary>
        )}

        {activeTab === 'catalog' && (
          <ErrorBoundary viewName="Taxonomic Catalog">
            <SpeciesCatalog onSelectForTest={handleSelectSpeciesForTest} />
          </ErrorBoundary>
        )}

        {activeTab === 'observations' && (
          <ErrorBoundary viewName="Observation Log">
            <ObservationLog
              observations={observations}
              speciesList={speciesList}
              onDeleteObservation={handleDeleteObservation}
              onNavigateToClassifier={() => setActiveTab('classifier')}
            />
          </ErrorBoundary>
        )}

        {activeTab === 'dashboard' && (
          <ErrorBoundary viewName="Ecosystem Dashboard">
            <EcosystemDashboard
              observations={observations}
              speciesList={speciesList}
              onNavigateToCatalog={() => setActiveTab('catalog')}
              onNavigateToClassifier={() => setActiveTab('classifier')}
            />
          </ErrorBoundary>
        )}

        {activeTab === 'dataset' && (
          <ErrorBoundary viewName="Dataset & ML Pipeline">
            <DatasetManager />
          </ErrorBoundary>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-emerald-500/15 py-4 bg-[#05080d] text-xs text-slate-500 text-center">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            BirdSong Bioacoustic System • FFT Spectral Analysis & Avian Population Sentinel
          </span>
          <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
            <span>Database: SQLite Persistent</span>
            <span>•</span>
            <span>Observations: {observations.length}</span>
            <span>•</span>
            <span>Species: {speciesList.length}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
