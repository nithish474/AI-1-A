export type IUCNStatus = 'LC' | 'NT' | 'VU' | 'EN' | 'CR';

export type VocalType =
  | 'Song'
  | 'Call'
  | 'Trill'
  | 'Drumming'
  | 'Hoot'
  | 'Screech'
  | 'Warble';

export type BioindicatorSensitivity = 'High' | 'Moderate' | 'Low';

export type SynthesisShape =
  | 'chirp'
  | 'trill'
  | 'hoot'
  | 'screech'
  | 'warble'
  | 'staccato';

export interface AcousticProfile {
  synthesisShape: SynthesisShape;
  sweepType: 'linear' | 'concave' | 'convex' | 'steep' | 'harmonic';
  harmonics: number;
  syllablesPerSec: number;
  tempoBpm: number;
  fmModulation?: number; // Frequency modulation depth in Hz
  noiseRatio?: number; // 0 to 1
}

export interface BirdSpecies {
  id: string;
  commonName: string;
  scientificName: string;
  family: string;
  order: string;
  iucnStatus: IUCNStatus;
  habitat: string;
  bioindicatorSensitivity: BioindicatorSensitivity;
  frequencyRange: [number, number]; // [minHz, maxHz]
  peakFrequencyHz: number;
  vocalType: VocalType;
  acousticProfile: AcousticProfile;
  description: string;
  identificationTips: string[];
  distribution: string;
  sampleAudioDesc: string;
  threats: string[];
  diet?: string;
  bioindicatorRole?: string;
  sensitivityScore?: number; // 1-10 (>= 7 is bioindicator species)
  imageUrl?: string;
}

export interface AcousticFeatures {
  peakFrequencyHz: number;
  spectralCentroid: number;
  bandwidth: number;
  duration: number;
  zeroCrossingRate?: number;
  harmonicity?: number;
  confidence?: number;
  // Real call-detection metrics
  callsDetected: number;
  durationSeconds: number;
  callsPerMinute?: number;
  activityLevel?: 'Low' | 'Moderate' | 'High';
  activityEstimationUnavailable?: boolean;
  activityUnavailableReason?: string;
  callTimestamps?: number[];
}

export type ExtractedAudioFeatures = AcousticFeatures;

export interface CandidateMatch {
  species: BirdSpecies;
  confidence: number;
  spectralDistance: number;
  matchRationale: string;
}

export interface ClassificationResult {
  requestId: string;
  matchedSpecies: BirdSpecies;
  confidence: number;
  candidateMatches: CandidateMatch[];
  extractedFeatures: AcousticFeatures;
  aiExplanation?: string;
  isAiGenerated: boolean;
  timestamp: string;
  source: 'microphone' | 'file' | 'sample';
  classificationSource?: 'gemini-multimodal' | 'spectral-heuristic';
  // Real activity metrics
  callsDetected: number;
  durationSeconds: number;
  callsPerMinute?: number;
  activityLevel?: 'Low' | 'Moderate' | 'High';
  activityEstimationUnavailable?: boolean;
  activityUnavailableReason?: string;
}

export interface Observation {
  id: string;
  speciesId: string;
  timestamp: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  confidence: number;
  notes: string;
  source: 'classifier' | 'manual';
  audioSource?: 'microphone' | 'file' | 'sample' | 'manual';
  audioFilePath?: string;
  callsDetected: number;
  durationSeconds: number;
  callsPerMinute?: number;
  activityLevel?: 'Low' | 'Moderate' | 'High';
  activityUnavailableReason?: string;
  ecosystemScoreAtTime?: number;
  peakFrequencyHz?: number;
  locationSource?: 'gps' | 'manual' | 'map' | 'station' | 'unavailable';
  isDemo?: boolean;
}

export interface BiodiversityMetrics {
  totalObservations: number;
  uniqueSpeciesCount: number;
  shannonWienerIndex: number;
  simpsonIndex: number;
  evennessIndex: number;
  ecosystemHealthScore: number;
  ecosystemHealth: 'Optimal' | 'Stable' | 'Vulnerable' | 'Degraded';
  iucnCounts: {
    LC: number;
    NT: number;
    VU: number;
    EN: number;
    CR: number;
  };
  bioindicatorAlerts: {
    speciesId: string;
    sensitivity: BioindicatorSensitivity;
    status: 'detected' | 'absent';
    message: string;
  }[];
}

export interface PredictionCandidate {
  species_id: string;
  common_name: string;
  scientific_name?: string;
  model_score: number;
  rank: number;
}

export interface PredictionRecord {
  id: string;
  observationId?: string;
  recordingId?: string;
  predictedSpeciesId: string;
  topCandidates: PredictionCandidate[];
  confidence: number;
  modelVersion: string;
  classificationMethod: 'cnn' | 'gemini-multimodal' | 'spectral-heuristic';
  timestamp: string;
  inferenceStatus: 'success' | 'uncertain' | 'error';
  userConfirmedSpeciesId?: string;
  notes?: string;
}

export interface DatasetStats {
  totalRecords: number;
  validRecordings: number;
  rejectedRecordings: number;
  totalDurationHours: number;
  totalDurationSeconds: number;
  speciesCounts: Record<string, number>;
  splitCounts: {
    train: number;
    val: number;
    test: number;
    unassigned: number;
  };
  sources: Record<string, number>;
}

