import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  BarChart3,
  Trees,
  CheckCircle2,
  AlertTriangle,
  HeartHandshake,
  Activity,
  Leaf,
  Calendar,
  Layers,
  ArrowRight,
  MapPin,
  Compass,
  X,
  Volume2,
  Play,
  Pause,
  ExternalLink,
  Radio,
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
  CartesianGrid,
} from 'recharts';
import { Observation, BirdSpecies } from '../types';
import { BIRD_SPECIES } from '../data/birds';
import { calculateEcosystemScore } from '../config/ecosystemScoring';
import { calculateBiodiversityMetrics } from '../utils/biodiversityMetrics';
import { FilterBar, NoResultsEmptyState } from './FilterBar';
import { ObservationMap } from './ObservationMap';
import { playBirdCall } from '../utils/audioSynth';
import {
  filterObservations,
  getDistinctLocations,
  ObservationFilters,
} from '../utils/filters';

interface EcosystemDashboardProps {
  observations: Observation[];
  speciesList?: BirdSpecies[];
  onNavigateToCatalog?: () => void;
  onNavigateToClassifier?: () => void;
}

const ACTIVITY_COLORS: Record<string, string> = {
  High: '#f59e0b',
  Moderate: '#10b981',
  Low: '#38bdf8',
  'Short Clip': '#64748b',
};

const IUCN_COLORS: Record<string, string> = {
  LC: '#10B981',
  NT: '#EAB308',
  VU: '#F97316',
  EN: '#EF4444',
  CR: '#9333EA',
};

export const EcosystemDashboard: React.FC<EcosystemDashboardProps> = ({
  observations,
  speciesList = BIRD_SPECIES,
  onNavigateToCatalog,
  onNavigateToClassifier,
}) => {
  // Filter state
  const [selectedLocation, setSelectedLocation] = useState('all');
  const [selectedActivity, setSelectedActivity] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Observation Detail Modal state from Map selection
  const [selectedMapObservation, setSelectedMapObservation] = useState<Observation | null>(null);
  const [isPlayingObsAudio, setIsPlayingObsAudio] = useState(false);
  const stopAudioRef = useRef<(() => void) | null>(null);

  // Stop audio on modal close or unmount
  useEffect(() => {
    return () => {
      if (stopAudioRef.current) {
        stopAudioRef.current();
        stopAudioRef.current = null;
      }
    };
  }, []);

  const speciesMap = useMemo(() => {
    const map = new Map<string, BirdSpecies>();
    speciesList.forEach((s) => map.set(s.id, s));
    return map;
  }, [speciesList]);

  const distinctLocations = useMemo(
    () => getDistinctLocations(observations),
    [observations]
  );

  const filters: ObservationFilters = useMemo(
    () => ({
      location: selectedLocation,
      activityLevel: selectedActivity,
      startDate: startDate ? new Date(startDate).toISOString() : undefined,
      endDate: endDate ? new Date(endDate + 'T23:59:59').toISOString() : undefined,
    }),
    [selectedLocation, selectedActivity, startDate, endDate]
  );

  const filteredObservations = useMemo(
    () => filterObservations(observations, filters, speciesMap),
    [observations, filters, speciesMap]
  );

  const hasActiveFilters =
    selectedLocation !== 'all' ||
    selectedActivity !== 'all' ||
    Boolean(startDate) ||
    Boolean(endDate);

  const handleClearFilters = () => {
    setSelectedLocation('all');
    setSelectedActivity('all');
    setStartDate('');
    setEndDate('');
  };

  // Real calculation from observation data
  const bioMetrics = useMemo(
    () => calculateBiodiversityMetrics(filteredObservations),
    [filteredObservations]
  );

  const scoreResult = useMemo(
    () =>
      calculateEcosystemScore(
        filteredObservations,
        speciesList,
        bioMetrics.shannonWienerIndex
      ),
    [filteredObservations, speciesList, bioMetrics.shannonWienerIndex]
  );

  const indicatorSpeciesCount = useMemo(() => {
    return filteredObservations.filter((o) => {
      const sp = speciesMap.get(o.speciesId);
      return (sp?.sensitivityScore ?? 0) >= 7;
    }).length;
  }, [filteredObservations, speciesMap]);

  // Audio audition handler for selected map observation modal
  const handleToggleObsAudio = async (obs: Observation, species?: BirdSpecies) => {
    if (isPlayingObsAudio) {
      if (stopAudioRef.current) {
        stopAudioRef.current();
        stopAudioRef.current = null;
      }
      setIsPlayingObsAudio(false);
      return;
    }

    if (obs.audioFilePath) {
      const audio = new Audio(obs.audioFilePath);
      audio.play().catch(console.error);
      setIsPlayingObsAudio(true);
      stopAudioRef.current = () => audio.pause();
      audio.onended = () => {
        setIsPlayingObsAudio(false);
        stopAudioRef.current = null;
      };
      return;
    }

    if (species) {
      try {
        setIsPlayingObsAudio(true);
        const stopFn = await playBirdCall(species, 2.5);
        stopAudioRef.current = stopFn;
        setTimeout(() => {
          setIsPlayingObsAudio(false);
          stopAudioRef.current = null;
        }, 2600);
      } catch (err) {
        console.error('Audio playback failed', err);
        setIsPlayingObsAudio(false);
      }
    }
  };

  // 1. Chart Data: Species Count by Family
  const familyData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const obs of filteredObservations) {
      const sp = speciesMap.get(obs.speciesId);
      const fam = sp?.family || 'Other';
      counts.set(fam, (counts.get(fam) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 7);
  }, [filteredObservations, speciesMap]);

  // 2. Chart Data: Observations Timeline (Area chart)
  const timelineData = useMemo(() => {
    const dateMap = new Map<string, number>();
    for (const obs of filteredObservations) {
      const dateKey = new Date(obs.timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      dateMap.set(dateKey, (dateMap.get(dateKey) || 0) + 1);
    }
    return Array.from(dateMap.entries()).map(([date, count]) => ({ date, count }));
  }, [filteredObservations]);

  // 3. Chart Data: Activity Level Distribution (Pie)
  const activityData = useMemo(() => {
    let high = 0;
    let moderate = 0;
    let low = 0;
    let shortClip = 0;

    for (const obs of filteredObservations) {
      if (obs.activityLevel === 'High') high++;
      else if (obs.activityLevel === 'Moderate') moderate++;
      else if (obs.activityLevel === 'Low') low++;
      else shortClip++;
    }

    const items = [
      { name: 'High Activity', value: high, color: ACTIVITY_COLORS.High },
      { name: 'Moderate Activity', value: moderate, color: ACTIVITY_COLORS.Moderate },
      { name: 'Low Activity', value: low, color: ACTIVITY_COLORS.Low },
    ];
    if (shortClip > 0) {
      items.push({ name: 'Short Clip (<5s)', value: shortClip, color: ACTIVITY_COLORS['Short Clip'] });
    }
    return items.filter((i) => i.value > 0);
  }, [filteredObservations]);

  // 4. Chart Data: Acoustic Frequency Distribution across detections
  const frequencyData = useMemo(() => {
    const bins = [
      { range: '0-2 kHz', count: 0, label: 'Low Frequency' },
      { range: '2-4 kHz', count: 0, label: 'Mid-Low' },
      { range: '4-6 kHz', count: 0, label: 'Mid-High' },
      { range: '6-8 kHz', count: 0, label: 'High' },
      { range: '8+ kHz', count: 0, label: 'Ultra High' },
    ];

    for (const obs of filteredObservations) {
      const sp = speciesMap.get(obs.speciesId);
      const freq = obs.peakFrequencyHz || sp?.peakFrequencyHz || 3000;
      if (freq < 2000) bins[0].count++;
      else if (freq < 4000) bins[1].count++;
      else if (freq < 6000) bins[2].count++;
      else if (freq < 8000) bins[3].count++;
      else bins[4].count++;
    }
    return bins;
  }, [filteredObservations, speciesMap]);

  return (
    <div id="ecosystem-dashboard-panel" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-emerald-500/20">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            Soundscape Ecological Dashboard
          </h2>
          <p className="text-sm text-slate-300 mt-1 max-w-2xl">
            Real-time bioacoustic indices, spatial geolocation mapping, Shannon diversity calculations,
            and indicator species presence derived strictly from verified field observations.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <FilterBar
        hasActiveFilters={hasActiveFilters}
        onClearFilters={handleClearFilters}
        totalCount={observations.length}
        filteredCount={filteredObservations.length}
        dropdowns={[
          {
            id: 'location',
            label: 'Location',
            value: selectedLocation,
            onChange: setSelectedLocation,
            options: [
              { value: 'all', label: 'All Locations' },
              ...distinctLocations.map((l) => ({ value: l, label: l })),
            ],
          },
          {
            id: 'activity',
            label: 'Activity',
            value: selectedActivity,
            onChange: setSelectedActivity,
            options: [
              { value: 'all', label: 'All Activity' },
              { value: 'High', label: 'High' },
              { value: 'Moderate', label: 'Moderate' },
              { value: 'Low', label: 'Low' },
            ],
          },
        ]}
        dateRange={{
          startDate,
          endDate,
          onStartDateChange: setStartDate,
          onEndDateChange: setEndDate,
        }}
      />

      {/* Empty / Insufficient data guard check */}
      {filteredObservations.length < 2 ? (
        <div
          id="insufficient-data-state"
          className="flex flex-col items-center justify-center p-16 text-center bg-slate-900/60 border border-dashed border-emerald-500/30 rounded-2xl"
        >
          <Activity className="w-12 h-12 text-emerald-400/50 mb-3" />
          <h3 className="text-lg font-bold text-white mb-1">
            Insufficient Data to Compute Diversity Metrics
          </h3>
          <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
            A minimum of 2 observations are required to calculate Shannon Diversity Index, Evenness,
            geospatial distribution, and soundscape health scores. Currently {filteredObservations.length} observation(s) selected.
          </p>
          {onNavigateToClassifier && (
            <button
              onClick={onNavigateToClassifier}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition"
            >
              <span>Record Observation</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Top Score Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Overall Soundscape Health Score */}
            <div className="bg-slate-900/70 border border-emerald-500/30 rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                <span className="font-semibold uppercase tracking-wider text-emerald-400">
                  Ecosystem Health
                </span>
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black font-mono text-emerald-300">
                  {scoreResult.score}
                </span>
                <span className="text-xs text-slate-400 font-mono">/ 100</span>
              </div>
              <p className="text-xs text-emerald-400/90 font-medium mt-1">
                {scoreResult.category} Ecological Condition
              </p>
              <div className="mt-3 w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${scoreResult.score}%` }}
                />
              </div>
            </div>

            {/* Shannon Diversity Index */}
            <div className="bg-slate-900/70 border border-emerald-500/20 rounded-2xl p-5 shadow-lg">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                <span className="font-semibold uppercase tracking-wider text-emerald-400">
                  Shannon Index (H')
                </span>
                <Trees className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-4xl font-black font-mono text-white">
                {scoreResult.shannonIndex.toFixed(2)}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Species Richness: <strong className="text-slate-200">{bioMetrics.uniqueSpeciesCount}</strong> taxa
              </p>
            </div>

            {/* Pielou's Evenness (J') */}
            <div className="bg-slate-900/70 border border-emerald-500/20 rounded-2xl p-5 shadow-lg">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                <span className="font-semibold uppercase tracking-wider text-emerald-400">
                  Evenness (J')
                </span>
                <Layers className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-4xl font-black font-mono text-white">
                {bioMetrics.evennessIndex.toFixed(2)}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Acoustic Niche Uniformity (0 to 1)
              </p>
            </div>

            {/* Indicator Species Presence */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 shadow-lg">
              <div className="flex items-center justify-between text-amber-300 text-xs mb-2">
                <span className="font-semibold uppercase tracking-wider text-amber-400">
                  Indicator Species
                </span>
                <Leaf className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black font-mono text-amber-300">
                  {indicatorSpeciesCount}
                </span>
                <span className="text-xs text-amber-400/80">detected</span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                Environmental Sentinels (Sensitivity ≥ 7)
              </p>
              {onNavigateToCatalog && (
                <button
                  onClick={onNavigateToCatalog}
                  className="mt-2 text-[11px] text-amber-300 hover:text-amber-200 font-semibold flex items-center gap-1 transition"
                >
                  <span>Explore Sentinels</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Indicator Species Explanatory Banner */}
          <div className="bg-slate-900/60 border border-emerald-500/20 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-300">
            <div className="flex items-center gap-2.5">
              <Leaf className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>
                <strong>Why track Indicator Species?</strong> Birds with high ecological sensitivity (scores ≥ 7)
                have narrow microclimatic tolerances and acoustic niche requirements. Their persistent vocal activity
                proves forest structural continuity and intact trophic chains.
              </span>
            </div>
            {onNavigateToCatalog && (
              <button
                onClick={onNavigateToCatalog}
                className="whitespace-nowrap px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-medium transition"
              >
                View Catalog Sentinels
              </button>
            )}
          </div>

          {/* Geospatial Soundscape Distribution Map Component */}
          <div className="space-y-3">
            <ObservationMap
              observations={filteredObservations}
              speciesList={speciesList}
              onSelectObservation={(obs) => {
                setSelectedMapObservation(obs);
              }}
              title="Avian Geolocation & Soundscape Distribution Map"
              subtitle="Spatial visualization of verified bioacoustic detections, GPS coordinates, and calling rate hotspots across field stations."
              height={460}
            />
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 1. Species Count by Family (Bar Chart) */}
            <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                <span>Species Detections by Family</span>
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                Taxonomic distribution across recorded observations.
              </p>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={familyData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="family"
                      stroke="#94a3b8"
                      fontSize={11}
                      angle={-20}
                      textAnchor="end"
                    />
                    <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #10b981',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 2. Observations Timeline (Area Chart) */}
            <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400" />
                <span>Soundscape Detections Over Time</span>
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                Chronological observation volume across survey dates.
              </p>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #10b981',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#10b981"
                      fill="#10b981"
                      fillOpacity={0.25}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 3. Activity Level Distribution (Pie Chart) */}
            <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>Vocal Activity Intensity</span>
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                Distribution of high, moderate, and low call rates per recording.
              </p>
              <div className="h-60 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={activityData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {activityData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #10b981',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-4 mt-2 text-xs">
                {activityData.map((item) => (
                  <div key={item.name} className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-slate-300">
                      {item.name}: <strong>{item.value}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 4. Acoustic Frequency Distribution (Bar Chart) */}
            <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <span>Soundscape Frequency Spectrum</span>
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                Binned spectral peak frequencies across avian vocalizations.
              </p>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={frequencyData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="range" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #10b981',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="count" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Observation Inspection Modal from Map Marker Selection */}
      {selectedMapObservation && (
        <div
          id="map-observation-modal"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => {
            if (stopAudioRef.current) {
              stopAudioRef.current();
              stopAudioRef.current = null;
            }
            setIsPlayingObsAudio(false);
            setSelectedMapObservation(null);
          }}
        >
          <div
            className="bg-slate-900 border border-emerald-500/30 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl text-slate-200 animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Top Header */}
            <div className="flex items-start justify-between pb-4 border-b border-emerald-500/20">
              <div>
                <span className="text-[11px] font-mono text-emerald-400">
                  Observation #{selectedMapObservation.id.slice(0, 14)}
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <h3 className="text-xl font-bold text-white">
                    {speciesMap.get(selectedMapObservation.speciesId)?.commonName ||
                      selectedMapObservation.speciesId}
                  </h3>
                  {speciesMap.get(selectedMapObservation.speciesId)?.iucnStatus && (
                    <span
                      className={`text-xs font-mono px-1.5 py-0.5 rounded font-semibold ${
                        speciesMap.get(selectedMapObservation.speciesId)?.iucnStatus === 'LC'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {speciesMap.get(selectedMapObservation.speciesId)?.iucnStatus}
                    </span>
                  )}
                </div>
                <p className="text-xs italic text-emerald-400/90">
                  {speciesMap.get(selectedMapObservation.speciesId)?.scientificName || 'Aves sp.'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (stopAudioRef.current) {
                    stopAudioRef.current();
                    stopAudioRef.current = null;
                  }
                  setIsPlayingObsAudio(false);
                  setSelectedMapObservation(null);
                }}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="space-y-4 pt-4 text-xs">
              {/* Audio Audition Section */}
              <div className="bg-slate-950/80 p-3.5 rounded-xl border border-emerald-500/20 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <Radio className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-white block">Acoustic Audio Playback</span>
                    <span className="text-[11px] text-slate-400">
                      {selectedMapObservation.audioFilePath
                        ? 'Verified Field Audio Recording'
                        : 'Procedural Bioacoustic Synthesis'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    handleToggleObsAudio(
                      selectedMapObservation,
                      speciesMap.get(selectedMapObservation.speciesId)
                    )
                  }
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    isPlayingObsAudio
                      ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md'
                  }`}
                >
                  {isPlayingObsAudio ? (
                    <>
                      <Pause className="w-3.5 h-3.5 fill-current" />
                      <span>Pause Audio</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Play Song</span>
                    </>
                  )}
                </button>
              </div>

              {/* Bioacoustic Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="bg-slate-950/60 p-2.5 rounded-xl border border-emerald-500/15">
                  <span className="text-[10px] text-slate-400 block uppercase font-mono">Confidence</span>
                  <strong className="text-emerald-300 font-mono text-base">
                    {Math.round(selectedMapObservation.confidence * 100)}%
                  </strong>
                </div>
                <div className="bg-slate-950/60 p-2.5 rounded-xl border border-emerald-500/15">
                  <span className="text-[10px] text-slate-400 block uppercase font-mono">Call Rate</span>
                  <strong className="text-white font-mono text-base">
                    {selectedMapObservation.callsPerMinute ?? '—'} <span className="text-xs text-slate-400">cpm</span>
                  </strong>
                </div>
                <div className="bg-slate-950/60 p-2.5 rounded-xl border border-emerald-500/15">
                  <span className="text-[10px] text-slate-400 block uppercase font-mono">Activity</span>
                  <strong className="text-amber-300 text-sm">
                    {selectedMapObservation.activityLevel || 'Standard'}
                  </strong>
                </div>
                <div className="bg-slate-950/60 p-2.5 rounded-xl border border-emerald-500/15">
                  <span className="text-[10px] text-slate-400 block uppercase font-mono">Peak Freq</span>
                  <strong className="text-sky-300 font-mono text-sm">
                    {selectedMapObservation.peakFrequencyHz
                      ? `${(selectedMapObservation.peakFrequencyHz / 1000).toFixed(1)} kHz`
                      : '—'}
                  </strong>
                </div>
              </div>

              {/* Location & GPS Geolocation Coordinates */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-emerald-500/20 space-y-2">
                <div className="flex items-center gap-2 text-white font-semibold">
                  <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{selectedMapObservation.location || 'Field Station'}</span>
                </div>
                {selectedMapObservation.latitude !== undefined &&
                  selectedMapObservation.longitude !== undefined && (
                    <div className="flex items-center justify-between text-xs font-mono text-emerald-300/90 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg border border-emerald-500/20">
                      <span>GPS Coordinates:</span>
                      <span className="font-bold">
                        {selectedMapObservation.latitude.toFixed(5)}°,{' '}
                        {selectedMapObservation.longitude.toFixed(5)}°
                      </span>
                    </div>
                  )}
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Recorded on {new Date(selectedMapObservation.timestamp).toLocaleString()}</span>
                </div>
              </div>

              {/* Observer Notes */}
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 block mb-1">
                  Field Observer Notes
                </span>
                <div className="bg-slate-950/60 p-3 rounded-xl border border-emerald-500/15 text-xs text-slate-300 italic">
                  {selectedMapObservation.notes || 'Standard bioacoustic survey detection recorded in field.'}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="mt-5 pt-4 border-t border-emerald-500/20 flex items-center justify-between gap-3">
              {onNavigateToCatalog && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMapObservation(null);
                    onNavigateToCatalog();
                  }}
                  className="px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Species Details in Catalog</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (stopAudioRef.current) {
                    stopAudioRef.current();
                    stopAudioRef.current = null;
                  }
                  setIsPlayingObsAudio(false);
                  setSelectedMapObservation(null);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition cursor-pointer ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
