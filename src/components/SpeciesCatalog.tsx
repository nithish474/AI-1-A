import React, { useState, useEffect, useMemo } from 'react';
import {
  Volume2,
  Square,
  Activity,
  ChevronRight,
  Sparkles,
  Shield,
  Leaf,
  Info,
  X,
  AlertCircle,
} from 'lucide-react';
import { BirdSpecies, IUCNStatus } from '../types';
import { BIRD_SPECIES } from '../data/birds';
import { playBirdCall } from '../utils/audioSynth';
import {
  filterSpecies,
  getDistinctFamilies,
  getDistinctHabitats,
  SpeciesFilters,
} from '../utils/filters';
import { FilterBar, NoResultsEmptyState } from './FilterBar';
import { SpeciesAssistantModal } from './SpeciesAssistantModal';

interface SpeciesCatalogProps {
  onSelectForTest?: (speciesId: string) => void;
}

export const SpeciesCatalog: React.FC<SpeciesCatalogProps> = ({ onSelectForTest }) => {
  const [speciesList, setSpeciesList] = useState<BirdSpecies[]>(BIRD_SPECIES);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [search, setSearch] = useState('');
  const [selectedFamily, setSelectedFamily] = useState('all');
  const [selectedHabitat, setSelectedHabitat] = useState('all');
  const [selectedIUCN, setSelectedIUCN] = useState('all');
  const [selectedSensitivity, setSelectedSensitivity] = useState('all');

  // Audio audition state
  const [playingSpeciesId, setPlayingSpeciesId] = useState<string | null>(null);
  const [activeStopFn, setActiveStopFn] = useState<(() => void) | null>(null);

  // Selected species for detail modal
  const [detailSpecies, setDetailSpecies] = useState<BirdSpecies | null>(null);
  // Selected species for AI Assistant modal
  const [assistantSpecies, setAssistantSpecies] = useState<BirdSpecies | null>(null);

  // Fetch species from backend SQLite DB
  useEffect(() => {
    let isMounted = true;
    async function fetchSpecies() {
      try {
        setLoading(true);
        const res = await fetch('/api/species');
        if (!res.ok) throw new Error('Failed to load species from server');
        const data = await res.json();
        if (isMounted && Array.isArray(data) && data.length > 0) {
          setSpeciesList(data);
        }
      } catch (err) {
        console.warn('Using local species cache:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    fetchSpecies();
    return () => {
      isMounted = false;
    };
  }, []);

  // Distinct filter options extracted dynamically from loaded data
  const distinctFamilies = useMemo(() => getDistinctFamilies(speciesList), [speciesList]);
  const distinctHabitats = useMemo(() => getDistinctHabitats(speciesList), [speciesList]);

  const activeFilters: SpeciesFilters = useMemo(
    () => ({
      search,
      family: selectedFamily,
      habitat: selectedHabitat,
      iucnStatus: selectedIUCN,
      sensitivity: selectedSensitivity,
    }),
    [search, selectedFamily, selectedHabitat, selectedIUCN, selectedSensitivity]
  );

  const filteredSpecies = useMemo(
    () => filterSpecies(speciesList, activeFilters),
    [speciesList, activeFilters]
  );

  const hasActiveFilters =
    Boolean(search) ||
    selectedFamily !== 'all' ||
    selectedHabitat !== 'all' ||
    selectedIUCN !== 'all' ||
    selectedSensitivity !== 'all';

  const handleClearFilters = () => {
    setSearch('');
    setSelectedFamily('all');
    setSelectedHabitat('all');
    setSelectedIUCN('all');
    setSelectedSensitivity('all');
  };

  const handleTogglePlay = async (species: BirdSpecies, e: React.MouseEvent) => {
    e.stopPropagation();

    if (playingSpeciesId === species.id) {
      if (activeStopFn) {
        activeStopFn();
        setActiveStopFn(null);
      }
      setPlayingSpeciesId(null);
    } else {
      if (activeStopFn) {
        activeStopFn();
      }
      const stopFn = await playBirdCall(species, 2.5);
      setActiveStopFn(() => stopFn);
      setPlayingSpeciesId(species.id);

      setTimeout(() => {
        setPlayingSpeciesId((curr) => (curr === species.id ? null : curr));
      }, 2500);
    }
  };

  return (
    <div id="species-catalog-container" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-emerald-500/20">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            Avian Taxonomic & Soundscape Library
          </h2>
          <p className="text-sm text-slate-300 mt-1 max-w-2xl">
            Explore cataloged species calibrated for bioacoustic frequency analysis, IUCN threat tracking,
            and soundscape bioindicator sensitivity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-emerald-300 bg-slate-900/80 px-3.5 py-1.5 rounded-xl border border-emerald-500/30">
            Database: <strong>{speciesList.length}</strong> Species
          </span>
        </div>
      </div>

      {/* Shared FilterBar */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by common name, scientific name, or family..."
        totalCount={speciesList.length}
        filteredCount={filteredSpecies.length}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={handleClearFilters}
        dropdowns={[
          {
            id: 'family',
            label: 'Family',
            value: selectedFamily,
            onChange: setSelectedFamily,
            options: [
              { value: 'all', label: 'All Families' },
              ...distinctFamilies.map((f) => ({ value: f, label: f })),
            ],
          },
          {
            id: 'habitat',
            label: 'Habitat',
            value: selectedHabitat,
            onChange: setSelectedHabitat,
            options: [
              { value: 'all', label: 'All Habitats' },
              ...distinctHabitats.map((h) => ({ value: h, label: h })),
            ],
          },
          {
            id: 'iucn',
            label: 'IUCN',
            value: selectedIUCN,
            onChange: setSelectedIUCN,
            options: [
              { value: 'all', label: 'All Statuses' },
              { value: 'LC', label: 'LC - Least Concern' },
              { value: 'NT', label: 'NT - Near Threatened' },
              { value: 'VU', label: 'VU - Vulnerable' },
              { value: 'EN', label: 'EN - Endangered' },
              { value: 'CR', label: 'CR - Critically Endangered' },
            ],
          },
          {
            id: 'sensitivity',
            label: 'Indicator Sensitivity',
            value: selectedSensitivity,
            onChange: setSelectedSensitivity,
            options: [
              { value: 'all', label: 'All Sensitivities' },
              { value: 'High', label: 'High (Sentinel ≥7)' },
              { value: 'Moderate', label: 'Moderate' },
              { value: 'Low', label: 'Low (Generalist)' },
            ],
          },
        ]}
      />

      {/* Species Cards Grid */}
      {filteredSpecies.length === 0 ? (
        <NoResultsEmptyState
          onClear={handleClearFilters}
          message="No species match your selected filter criteria."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredSpecies.map((species) => {
            const isPlaying = playingSpeciesId === species.id;
            const isIndicator =
              (species.sensitivityScore !== undefined && species.sensitivityScore >= 7) ||
              species.bioindicatorSensitivity === 'High';

            return (
              <div
                key={species.id}
                id={`species-card-${species.id}`}
                onClick={() => setDetailSpecies(species)}
                className="bg-slate-900/60 border border-emerald-500/20 hover:border-emerald-500/50 rounded-2xl p-5 flex flex-col justify-between transition-all group cursor-pointer shadow-lg hover:shadow-emerald-950/30"
              >
                <div>
                  {/* Top badges */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded font-mono ${
                        species.iucnStatus === 'LC'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : species.iucnStatus === 'NT'
                          ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      IUCN: {species.iucnStatus}
                    </span>

                    {isIndicator && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                        <Leaf className="w-3 h-3 text-amber-400" />
                        Indicator Species
                      </span>
                    )}
                  </div>

                  {/* Title & Taxonomy */}
                  <h3 className="text-lg font-bold text-white group-hover:text-emerald-300 transition-colors">
                    {species.commonName}
                  </h3>
                  <p className="text-xs text-slate-400 italic mb-2">
                    {species.scientificName} • <span className="text-slate-300">{species.family}</span>
                  </p>

                  {/* Description preview */}
                  <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed mb-3">
                    {species.description || 'Not available'}
                  </p>

                  {/* Habitat & Acoustic Specs */}
                  <div className="bg-slate-950/60 rounded-xl p-3 border border-emerald-500/10 space-y-1.5 text-xs text-slate-300">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[11px]">Habitat:</span>
                      <span className="text-right truncate max-w-[170px] font-medium text-emerald-200">
                        {species.habitat}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[11px]">Peak Frequency:</span>
                      <span className="font-mono text-emerald-400 font-semibold">
                        {species.peakFrequencyHz} Hz
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[11px]">Sensitivity Score:</span>
                      <span className="font-mono text-amber-300 font-semibold">
                        {species.sensitivityScore ?? (species.bioindicatorSensitivity === 'High' ? 8 : 5)} / 10
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card footer actions */}
                <div className="mt-4 pt-3 border-t border-emerald-500/15 flex items-center justify-between gap-2">
                  <button
                    id={`play-sound-btn-${species.id}`}
                    onClick={(e) => handleTogglePlay(species, e)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-all ${
                      isPlaying
                        ? 'bg-emerald-500 text-white border-emerald-400 shadow-md shadow-emerald-500/30'
                        : 'bg-slate-800 text-emerald-300 border-emerald-500/30 hover:bg-slate-700'
                    }`}
                    title="Audition synthesized call"
                  >
                    {isPlaying ? (
                      <>
                        <Square className="w-3.5 h-3.5 fill-current" />
                        <span>Playing...</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>Audition</span>
                      </>
                    )}
                  </button>

                  <div className="flex items-center gap-1.5">
                    {onSelectForTest && (
                      <button
                        id={`test-synth-btn-${species.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectForTest(species.id);
                        }}
                        className="px-2.5 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-medium flex items-center gap-1 transition"
                      >
                        <Sparkles className="w-3 h-3 text-emerald-400" />
                        <span>Test in Classifier</span>
                      </button>
                    )}
                    <button
                      className="p-1.5 text-slate-400 hover:text-emerald-300 rounded-lg"
                      title="View Full Profile"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Species Detail Modal */}
      {detailSpecies && (
        <div
          id="species-detail-modal-overlay"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDetailSpecies(null)}
        >
          <div
            id="species-detail-modal-card"
            className="bg-slate-900 border border-emerald-500/30 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl text-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-emerald-500/20">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-xs font-bold px-2.5 py-0.5 rounded font-mono ${
                      detailSpecies.iucnStatus === 'LC'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : detailSpecies.iucnStatus === 'NT'
                        ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    }`}
                  >
                    IUCN: {detailSpecies.iucnStatus}
                  </span>
                  <span className="text-xs px-2.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                    Order: {detailSpecies.order || 'Passeriformes'}
                  </span>
                </div>
                <h3 className="text-2xl font-bold text-white">{detailSpecies.commonName}</h3>
                <p className="text-sm text-emerald-400 italic">
                  {detailSpecies.scientificName} • {detailSpecies.family}
                </p>
              </div>

              <button
                id="close-species-modal-btn"
                onClick={() => setDetailSpecies(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="space-y-5 pt-4">
              {/* Description */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
                  Description
                </h4>
                <p className="text-sm text-slate-300 leading-relaxed">
                  {detailSpecies.description || 'Not available'}
                </p>
              </div>

              {/* Habitat & Diet */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-950/60 p-3.5 rounded-xl border border-emerald-500/15">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
                    Habitat
                  </h4>
                  <p className="text-sm text-slate-200">{detailSpecies.habitat || 'Not available'}</p>
                </div>
                <div className="bg-slate-950/60 p-3.5 rounded-xl border border-emerald-500/15">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
                    Diet
                  </h4>
                  <p className="text-sm text-slate-200">{detailSpecies.diet || 'Not available'}</p>
                </div>
              </div>

              {/* Acoustic Profile */}
              <div className="bg-slate-950/70 p-4 rounded-xl border border-emerald-500/20">
                <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2">
                  Acoustic Signature
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Peak Frequency</span>
                    <strong className="text-emerald-300 text-sm font-mono">
                      {detailSpecies.peakFrequencyHz} Hz
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Frequency Range</span>
                    <strong className="text-slate-200 font-mono">
                      {detailSpecies.frequencyRange[0]} - {detailSpecies.frequencyRange[1]} Hz
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Vocal Type</span>
                    <strong className="text-slate-200">{detailSpecies.vocalType}</strong>
                  </div>
                </div>
                {detailSpecies.sampleAudioDesc && (
                  <p className="mt-2.5 pt-2 border-t border-slate-800 text-xs text-slate-400 italic">
                    "{detailSpecies.sampleAudioDesc}"
                  </p>
                )}
              </div>

              {/* Bioindicator & Sensitivity Section */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-amber-400" />
                  <h4 className="text-sm font-bold text-amber-300">
                    Bioindicator Role & Sensitivity Rating
                  </h4>
                  <span className="ml-auto font-mono text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30">
                    Score: {detailSpecies.sensitivityScore ?? (detailSpecies.bioindicatorSensitivity === 'High' ? 8 : 5)} / 10
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed mb-2">
                  {detailSpecies.bioindicatorRole ||
                    (detailSpecies.bioindicatorSensitivity === 'High'
                      ? 'High-sensitivity environmental sentinel whose acoustic activity confirms contiguous canopy health and intact trophic webs.'
                      : 'Moderate bioindicator sensitive to environmental microclimate alterations.')}
                </p>
                <div className="text-[11px] text-amber-400/90 bg-amber-950/40 p-2.5 rounded-lg border border-amber-500/20">
                  <strong>Soundscape Monitoring Meaning:</strong> A sensitivity score ≥ 7 designates
                  an Indicator Species. Their vocalizations are highly susceptible to anthropogenic noise
                  and habitat disturbance, making their presence a direct measure of pristine ecological integrity.
                </div>
              </div>

              {/* Identification Tips & Threats */}
              {detailSpecies.identificationTips && detailSpecies.identificationTips.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1.5">
                    Field Identification Tips
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-xs text-slate-300">
                    {detailSpecies.identificationTips.map((tip, idx) => (
                      <li key={idx}>{tip}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="mt-6 pt-4 border-t border-emerald-500/20 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => handleTogglePlay(detailSpecies, e)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>Audition Call</span>
                </button>

                <button
                  id="ask-ai-modal-btn"
                  onClick={() => {
                    setAssistantSpecies(detailSpecies);
                  }}
                  className="px-4 py-2 bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-semibold flex items-center gap-2 transition"
                >
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>Ask Field Guide AI</span>
                </button>
              </div>

              <button
                onClick={() => setDetailSpecies(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Assistant Modal */}
      {assistantSpecies && (
        <SpeciesAssistantModal
          species={assistantSpecies}
          onClose={() => setAssistantSpecies(null)}
        />
      )}
    </div>
  );
};
