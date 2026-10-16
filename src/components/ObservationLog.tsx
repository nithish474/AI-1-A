import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Download,
  Trash2,
  MapPin,
  Clock,
  Activity,
  Volume2,
  VolumeX,
  Play,
  Pause,
  X,
  Map as MapIcon,
  List,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Calendar,
} from 'lucide-react';
import { Observation, BirdSpecies } from '../types';
import { BIRD_SPECIES, BIRD_SPECIES_BY_ID } from '../data/birds';
import { FilterBar, NoResultsEmptyState } from './FilterBar';
import { ObservationMap } from './ObservationMap';
import {
  filterObservations,
  getDistinctLocations,
  ObservationFilters,
} from '../utils/filters';

interface ObservationLogProps {
  observations: Observation[];
  speciesList?: BirdSpecies[];
  onDeleteObservation: (id: string) => Promise<void> | void;
  onNavigateToClassifier?: () => void;
}

function sanitizeCSVField(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '""';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

export const ObservationLog: React.FC<ObservationLogProps> = ({
  observations,
  speciesList = BIRD_SPECIES,
  onDeleteObservation,
  onNavigateToClassifier,
}) => {
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [search, setSearch] = useState('');
  const [selectedSpeciesId, setSelectedSpeciesId] = useState('all');
  const [selectedLocation, setSelectedLocation] = useState('all');
  const [selectedActivity, setSelectedActivity] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Selected observation for modal detail view
  const [selectedObs, setSelectedObs] = useState<Observation | null>(null);

  // Delete confirmation modal state
  const [obsToDelete, setObsToDelete] = useState<Observation | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Audio playback state
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      search,
      speciesId: selectedSpeciesId,
      location: selectedLocation,
      activityLevel: selectedActivity,
      startDate: startDate ? new Date(startDate).toISOString() : undefined,
      endDate: endDate ? new Date(endDate + 'T23:59:59').toISOString() : undefined,
    }),
    [search, selectedSpeciesId, selectedLocation, selectedActivity, startDate, endDate]
  );

  const filteredObservations = useMemo(() => {
    const list = filterObservations(observations, filters, speciesMap);
    // Sort newest first by default
    return list.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [observations, filters, speciesMap]);

  const hasActiveFilters =
    Boolean(search) ||
    selectedSpeciesId !== 'all' ||
    selectedLocation !== 'all' ||
    selectedActivity !== 'all' ||
    Boolean(startDate) ||
    Boolean(endDate);

  const handleClearFilters = () => {
    setSearch('');
    setSelectedSpeciesId('all');
    setSelectedLocation('all');
    setSelectedActivity('all');
    setStartDate('');
    setEndDate('');
  };

  const handleTogglePlayAudio = (filePath?: string) => {
    if (!filePath) return;

    if (audioRef.current) {
      if (isPlayingAudio) {
        audioRef.current.pause();
        setIsPlayingAudio(false);
      } else {
        audioRef.current.play().then(() => setIsPlayingAudio(true)).catch(console.error);
      }
    }
  };

  const handleConfirmDelete = async () => {
    if (!obsToDelete) return;
    try {
      setIsDeleting(true);
      await onDeleteObservation(obsToDelete.id);
      if (selectedObs?.id === obsToDelete.id) {
        setSelectedObs(null);
      }
      setObsToDelete(null);
    } catch (err) {
      console.error('Failed to delete observation:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const exportCSV = () => {
    const headers = [
      'Observation ID',
      'Timestamp',
      'Common Name',
      'Scientific Name',
      'Family',
      'IUCN Status',
      'Location',
      'Latitude',
      'Longitude',
      'Confidence',
      'Duration (sec)',
      'Calls Detected',
      'Calls Per Minute',
      'Activity Level',
      'Ecosystem Health Score',
      'Observer Notes',
    ];

    const rows = filteredObservations.map((obs) => {
      const sp = speciesMap.get(obs.speciesId);
      return [
        sanitizeCSVField(obs.id),
        sanitizeCSVField(obs.timestamp),
        sanitizeCSVField(sp?.commonName || obs.speciesId),
        sanitizeCSVField(sp?.scientificName || 'Aves sp.'),
        sanitizeCSVField(sp?.family || ''),
        sanitizeCSVField(sp?.iucnStatus || 'LC'),
        sanitizeCSVField(obs.location || ''),
        sanitizeCSVField(obs.latitude),
        sanitizeCSVField(obs.longitude),
        sanitizeCSVField(Math.round(obs.confidence * 100) + '%'),
        sanitizeCSVField(obs.durationSeconds),
        sanitizeCSVField(obs.callsDetected),
        sanitizeCSVField(obs.callsPerMinute),
        sanitizeCSVField(obs.activityLevel || 'N/A'),
        sanitizeCSVField(obs.ecosystemScoreAtTime),
        sanitizeCSVField(obs.notes),
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `birdsong_observations_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="observation-log-container" className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-emerald-500/20">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            Soundscape Observation Journal
          </h2>
          <p className="text-sm text-slate-300 mt-1 max-w-2xl">
            Persistent historical log of verified bioacoustic recordings, acoustic activity metrics,
            and ecosystem indicator states.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* View Mode Toggle: List vs Map */}
          <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-1 flex items-center gap-1">
            <button
              id="toggle-view-list"
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                viewMode === 'list'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-emerald-300'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>List View</span>
            </button>
            <button
              id="toggle-view-map"
              onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                viewMode === 'map'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-emerald-300'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>Map View</span>
            </button>
          </div>

          {/* Export CSV Button */}
          {observations.length > 0 && (
            <button
              id="export-csv-btn"
              onClick={exportCSV}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
              title="Export sanitized CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search notes, species, or location..."
        totalCount={observations.length}
        filteredCount={filteredObservations.length}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={handleClearFilters}
        dropdowns={[
          {
            id: 'species',
            label: 'Species',
            value: selectedSpeciesId,
            onChange: setSelectedSpeciesId,
            options: [
              { value: 'all', label: 'All Species' },
              ...speciesList.map((s) => ({ value: s.id, label: s.commonName })),
            ],
          },
          {
            id: 'location',
            label: 'Location',
            value: selectedLocation,
            onChange: setSelectedLocation,
            options: [
              { value: 'all', label: 'All Locations' },
              ...distinctLocations.map((loc) => ({ value: loc, label: loc })),
            ],
          },
          {
            id: 'activity',
            label: 'Activity Level',
            value: selectedActivity,
            onChange: setSelectedActivity,
            options: [
              { value: 'all', label: 'All Activity' },
              { value: 'High', label: 'High Activity' },
              { value: 'Moderate', label: 'Moderate Activity' },
              { value: 'Low', label: 'Low Activity' },
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

      {/* Main View: Empty State vs Map vs Table List */}
      {observations.length === 0 ? (
        <div
          id="observation-empty-state"
          className="flex flex-col items-center justify-center p-16 text-center bg-slate-900/40 border border-dashed border-emerald-500/20 rounded-2xl"
        >
          <Activity className="w-12 h-12 text-emerald-400/40 mb-3" />
          <h3 className="text-lg font-bold text-white mb-1">No observations yet</h3>
          <p className="text-sm text-slate-400 max-w-md mb-6">
            Analyze a recording to create your first observation and begin logging soundscape biodiversity.
          </p>
          {onNavigateToClassifier && (
            <button
              id="cta-goto-classifier"
              onClick={onNavigateToClassifier}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition shadow-lg shadow-emerald-600/30"
            >
              <span>Launch Audio Classifier</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : filteredObservations.length === 0 ? (
        <NoResultsEmptyState
          onClear={handleClearFilters}
          message="No observations match your selected filter criteria."
        />
      ) : viewMode === 'map' ? (
        <ObservationMap
          observations={filteredObservations}
          speciesList={speciesList}
          onSelectObservation={(obs) => setSelectedObs(obs)}
        />
      ) : (
        /* Table View */
        <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table id="observations-table" className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 text-emerald-400 uppercase tracking-wider font-mono text-[11px] border-b border-emerald-500/20">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">Date & Time</th>
                  <th className="py-3.5 px-4 font-semibold">Species Identification</th>
                  <th className="py-3.5 px-4 font-semibold text-center">Confidence</th>
                  <th className="py-3.5 px-4 font-semibold text-center">Calls / CPM</th>
                  <th className="py-3.5 px-4 font-semibold text-center">Activity</th>
                  <th className="py-3.5 px-4 font-semibold">Location</th>
                  <th className="py-3.5 px-4 font-semibold text-center">Ecosystem Score</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-500/10">
                {filteredObservations.map((obs) => {
                  const sp = speciesMap.get(obs.speciesId);
                  const obsDate = new Date(obs.timestamp);
                  const formattedDate = obsDate.toLocaleDateString();
                  const formattedTime = obsDate.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <tr
                      key={obs.id}
                      id={`obs-row-${obs.id}`}
                      onClick={() => setSelectedObs(obs)}
                      className="hover:bg-slate-800/60 cursor-pointer transition"
                    >
                      {/* Date & Time */}
                      <td className="py-3.5 px-4 font-mono text-slate-300">
                        <div>{formattedDate}</div>
                        <div className="text-[10px] text-slate-500">{formattedTime}</div>
                      </td>

                      {/* Species */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-white text-sm">
                          {sp?.commonName || obs.speciesId}
                        </div>
                        <div className="text-emerald-400/90 italic text-[11px]">
                          {sp?.scientificName || 'Aves sp.'}
                        </div>
                      </td>

                      {/* Confidence */}
                      <td className="py-3.5 px-4 text-center font-mono">
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          {Math.round(obs.confidence * 100)}%
                        </span>
                      </td>

                      {/* Calls / CPM */}
                      <td className="py-3.5 px-4 text-center font-mono text-xs">
                        <div className="text-slate-200 font-semibold">{obs.callsDetected} calls</div>
                        <div className="text-[10px] text-slate-400">
                          {obs.callsPerMinute !== undefined ? `${obs.callsPerMinute} cpm` : '—'}
                        </div>
                      </td>

                      {/* Activity Badge */}
                      <td className="py-3.5 px-4 text-center">
                        {obs.activityLevel ? (
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                              obs.activityLevel === 'High'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : obs.activityLevel === 'Moderate'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                            }`}
                          >
                            {obs.activityLevel}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500">Short Clip</span>
                        )}
                      </td>

                      {/* Location */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1 text-slate-300">
                          <MapPin className="w-3.5 h-3.5 text-emerald-400/70 shrink-0" />
                          <span className="truncate max-w-[140px]">
                            {obs.location || 'Field Station'}
                          </span>
                        </div>
                      </td>

                      {/* Ecosystem Score at time */}
                      <td className="py-3.5 px-4 text-center font-mono">
                        {obs.ecosystemScoreAtTime !== undefined ? (
                          <span className="text-xs font-bold text-emerald-300">
                            {obs.ecosystemScoreAtTime} / 100
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <button
                          id={`delete-obs-btn-${obs.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setObsToDelete(obs);
                          }}
                          className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                          title="Delete observation"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Observation Detail View Modal */}
      {selectedObs && (
        <div
          id="observation-detail-modal"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedObs(null)}
        >
          <div
            className="bg-slate-900 border border-emerald-500/30 rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl text-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-emerald-500/20">
              <div>
                <span className="text-xs font-mono text-emerald-400">
                  Observation #{selectedObs.id.slice(0, 12)}
                </span>
                <h3 className="text-2xl font-bold text-white">
                  {speciesMap.get(selectedObs.speciesId)?.commonName || selectedObs.speciesId}
                </h3>
                <p className="text-xs italic text-emerald-400/80">
                  {speciesMap.get(selectedObs.speciesId)?.scientificName || 'Aves sp.'}
                </p>
              </div>

              <button
                id="close-obs-modal-btn"
                onClick={() => setSelectedObs(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="space-y-4 pt-4 text-sm">
              {/* Audio Playback Section */}
              <div className="bg-slate-950/80 p-4 rounded-xl border border-emerald-500/20">
                <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2 flex items-center gap-1.5">
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                  <span>Audio Recording</span>
                </h4>
                {selectedObs.audioFilePath ? (
                  <div className="flex items-center gap-3">
                    <audio
                      ref={audioRef}
                      src={selectedObs.audioFilePath}
                      onEnded={() => setIsPlayingAudio(false)}
                      className="hidden"
                    />
                    <button
                      id="play-stored-audio-btn"
                      onClick={() => handleTogglePlayAudio(selectedObs.audioFilePath)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition"
                    >
                      {isPlayingAudio ? (
                        <>
                          <Pause className="w-4 h-4 fill-white" />
                          <span>Pause Audio</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 fill-white" />
                          <span>Play Recording</span>
                        </>
                      )}
                    </button>
                    <span className="text-xs text-slate-400 font-mono">
                      {selectedObs.durationSeconds}s clip ({selectedObs.callsDetected} calls detected)
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">
                    Audio not available for this observation.
                  </p>
                )}
              </div>

              {/* Bioacoustic Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-950/60 p-3 rounded-xl border border-emerald-500/10">
                  <span className="text-[11px] text-slate-400 block">Confidence</span>
                  <strong className="text-emerald-300 font-mono text-base">
                    {Math.round(selectedObs.confidence * 100)}%
                  </strong>
                </div>
                <div className="bg-slate-950/60 p-3 rounded-xl border border-emerald-500/10">
                  <span className="text-[11px] text-slate-400 block">Calls Count</span>
                  <strong className="text-white font-mono text-base">
                    {selectedObs.callsDetected}
                  </strong>
                </div>
                <div className="bg-slate-950/60 p-3 rounded-xl border border-emerald-500/10">
                  <span className="text-[11px] text-slate-400 block">Calls / Min</span>
                  <strong className="text-slate-200 font-mono text-base">
                    {selectedObs.callsPerMinute ?? '—'}
                  </strong>
                </div>
                <div className="bg-slate-950/60 p-3 rounded-xl border border-emerald-500/10">
                  <span className="text-[11px] text-slate-400 block">Activity</span>
                  <strong className="text-amber-300 text-sm">
                    {selectedObs.activityLevel || 'N/A'}
                  </strong>
                </div>
              </div>

              {/* Location Details & Coordinates */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-emerald-500/15 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 text-slate-200">
                  <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="font-semibold">{selectedObs.location || 'Field Station'}</span>
                </div>
                {selectedObs.latitude !== undefined && selectedObs.longitude !== undefined && (
                  <div className="text-slate-400 font-mono text-[11px]">
                    GPS Coordinates: {selectedObs.latitude.toFixed(4)}°, {selectedObs.longitude.toFixed(4)}°
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Recorded on {new Date(selectedObs.timestamp).toLocaleString()}</span>
                </div>
              </div>

              {/* Observer Notes */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
                  Field Observer Notes
                </h4>
                <div className="bg-slate-950/60 p-3 rounded-xl border border-emerald-500/10 text-xs text-slate-300 italic">
                  {selectedObs.notes || 'No field notes attached to this record.'}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="mt-6 pt-4 border-t border-emerald-500/20 flex items-center justify-between">
              <button
                id="delete-obs-modal-btn"
                onClick={() => setObsToDelete(selectedObs)}
                className="px-3.5 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Observation</span>
              </button>

              <button
                onClick={() => setSelectedObs(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {obsToDelete && (
        <div
          id="delete-confirm-modal"
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !isDeleting && setObsToDelete(null)}
        >
          <div
            className="bg-slate-900 border border-rose-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl text-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-rose-400 mb-3">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-white">Confirm Deletion</h3>
            </div>
            <p className="text-sm text-slate-300 mb-6 leading-relaxed">
              Are you sure you want to permanently delete this observation for{' '}
              <strong className="text-white">
                {speciesMap.get(obsToDelete.speciesId)?.commonName || obsToDelete.speciesId}
              </strong>
              ? This action will remove the record and its audio file from the database.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                disabled={isDeleting}
                onClick={() => setObsToDelete(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                id="confirm-delete-btn"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition"
              >
                {isDeleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
