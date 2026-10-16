import { ACTIVITY_THRESHOLDS } from './acousticThresholds';
import { Observation, BirdSpecies } from '../types';

/**
 * Tunable parameters for the Observation-Based Ecosystem Health Indicator.
 * These are configurable defaults representing soundscape ecology standards.
 */
export const ECOSYSTEM_SCORING_CONFIG = {
  // Indicator exact display phrase
  EXACT_TITLE: 'Observation-Based Ecosystem Health Indicator',

  // Disclaimer text displayed next to the indicator
  EXACT_DISCLAIMER:
    'This indicator is calculated from observations recorded in this app and does not definitively diagnose ecosystem health from a single recording.',

  // Minimum required observations to calculate a meaningful score
  MIN_OBSERVATIONS_FOR_SCORE: 5,
  INSUFFICIENT_DATA_MESSAGE: 'Insufficient observations to calculate ecosystem indicator.',

  // Target observations for 100% frequency score
  TARGET_OBSERVATIONS_PER_WINDOW: 30,

  // Reference for maximum bird activity score (e.g. 30 calls/minute gives 100%)
  HIGH_ACTIVITY_REFERENCE_CPM: 30,

  // Sensitivity score threshold defining an indicator species
  INDICATOR_SPECIES_SENSITIVITY_THRESHOLD: 7,

  // Sub-score weights (must sum to 1.0)
  WEIGHTS: {
    speciesDiversity: 0.40,
    birdActivity: 0.30,
    observationFrequency: 0.20,
    indicatorSpecies: 0.10,
  },
};

export interface EcosystemScoreResult {
  hasSufficientData: boolean;
  score: number;
  category: 'Healthy' | 'Moderate' | 'Under Stress' | 'Insufficient Data';
  speciesDiversityScore: number;
  birdActivityScore: number;
  observationFrequencyScore: number;
  indicatorSpeciesScore: number;
  averageCallsPerMinute: number;
  shannonIndex: number;
  message?: string;
  disclaimer: string;
}

/**
 * Computes the official Observation-Based Ecosystem Health Indicator
 */
export function calculateObservationBasedEcosystemHealth(
  observations: Observation[],
  speciesList: BirdSpecies[],
  shannonIndex: number
): EcosystemScoreResult {
  if (observations.length < ECOSYSTEM_SCORING_CONFIG.MIN_OBSERVATIONS_FOR_SCORE) {
    return {
      hasSufficientData: false,
      score: 0,
      category: 'Insufficient Data',
      speciesDiversityScore: 0,
      birdActivityScore: 0,
      observationFrequencyScore: 0,
      indicatorSpeciesScore: 0,
      averageCallsPerMinute: 0,
      shannonIndex: Math.round(shannonIndex * 100) / 100,
      message: ECOSYSTEM_SCORING_CONFIG.INSUFFICIENT_DATA_MESSAGE,
      disclaimer: ECOSYSTEM_SCORING_CONFIG.EXACT_DISCLAIMER,
    };
  }

  const totalCatalogSpecies = Math.max(2, speciesList.length);

  // 1. Species Diversity Score (0 - 100)
  // round(min(100, (shannonIndex / ln(TOTAL_CATALOG_SPECIES)) * 100))
  const maxPossibleShannon = Math.log(totalCatalogSpecies);
  const speciesDiversityScore = Math.min(
    100,
    Math.max(0, Math.round((shannonIndex / maxPossibleShannon) * 100))
  );

  // 2. Bird Activity Score (0 - 100)
  // Piecewise linear mapping of avg calls_per_minute across observations
  const observationsWithCpm = observations.filter(
    (o) => typeof o.callsPerMinute === 'number' && !isNaN(o.callsPerMinute)
  );

  let avgCpm = 0;
  if (observationsWithCpm.length > 0) {
    const totalCpm = observationsWithCpm.reduce((acc, curr) => acc + (curr.callsPerMinute || 0), 0);
    avgCpm = totalCpm / observationsWithCpm.length;
  }

  let birdActivityScore = 0;
  const lowMax = ACTIVITY_THRESHOLDS.lowMaxCallsPerMinute; // 5
  const modMax = ACTIVITY_THRESHOLDS.moderateMaxCallsPerMinute; // 15
  const highRef = ECOSYSTEM_SCORING_CONFIG.HIGH_ACTIVITY_REFERENCE_CPM; // 30

  if (avgCpm <= 0) {
    birdActivityScore = 0;
  } else if (avgCpm <= lowMax) {
    // 0 -> 0, lowMax (5) -> 33
    birdActivityScore = (avgCpm / lowMax) * 33;
  } else if (avgCpm <= modMax) {
    // lowMax -> 33, modMax (15) -> 66
    birdActivityScore = 33 + ((avgCpm - lowMax) / (modMax - lowMax)) * 33;
  } else {
    // modMax -> 66, highRef (30) -> 100
    birdActivityScore = 66 + Math.min(34, ((avgCpm - modMax) / (highRef - modMax)) * 34);
  }
  birdActivityScore = Math.min(100, Math.max(0, Math.round(birdActivityScore)));

  // 3. Observation Frequency Score (0 - 100)
  // min(100, (observationsInWindow / targetObservationsPerWindow) * 100)
  const observationFrequencyScore = Math.min(
    100,
    Math.round(
      (observations.length / ECOSYSTEM_SCORING_CONFIG.TARGET_OBSERVATIONS_PER_WINDOW) * 100
    )
  );

  // 4. Indicator Species Score (0 - 100)
  // (uniqueIndicatorSpeciesObserved / uniqueSpeciesObserved) * 100
  // Indicator species: sensitivityScore >= 7 (or bioindicatorSensitivity === 'High')
  const observedSpeciesIds = new Set(observations.map((o) => o.speciesId));
  const uniqueSpeciesObservedCount = observedSpeciesIds.size;

  const speciesMap = new Map(speciesList.map((s) => [s.id, s]));
  let uniqueIndicatorCount = 0;

  for (const sId of observedSpeciesIds) {
    const sp = speciesMap.get(sId);
    if (sp) {
      const isIndicator =
        (sp.sensitivityScore !== undefined && sp.sensitivityScore >= 7) ||
        sp.bioindicatorSensitivity === 'High';
      if (isIndicator) {
        uniqueIndicatorCount++;
      }
    }
  }

  const indicatorSpeciesScore =
    uniqueSpeciesObservedCount > 0
      ? Math.min(100, Math.round((uniqueIndicatorCount / uniqueSpeciesObservedCount) * 100))
      : 0;

  // Final Composite Score (0 - 100)
  const compositeScore = Math.round(
    ECOSYSTEM_SCORING_CONFIG.WEIGHTS.speciesDiversity * speciesDiversityScore +
    ECOSYSTEM_SCORING_CONFIG.WEIGHTS.birdActivity * birdActivityScore +
    ECOSYSTEM_SCORING_CONFIG.WEIGHTS.observationFrequency * observationFrequencyScore +
    ECOSYSTEM_SCORING_CONFIG.WEIGHTS.indicatorSpecies * indicatorSpeciesScore
  );

  const finalScore = Math.min(100, Math.max(0, compositeScore));

  let category: 'Healthy' | 'Moderate' | 'Under Stress';
  if (finalScore >= 80) {
    category = 'Healthy';
  } else if (finalScore >= 50) {
    category = 'Moderate';
  } else {
    category = 'Under Stress';
  }

  return {
    hasSufficientData: true,
    score: finalScore,
    category,
    speciesDiversityScore,
    birdActivityScore,
    observationFrequencyScore,
    indicatorSpeciesScore,
    averageCallsPerMinute: Math.round(avgCpm * 10) / 10,
    shannonIndex: Math.round(shannonIndex * 100) / 100,
    disclaimer: ECOSYSTEM_SCORING_CONFIG.EXACT_DISCLAIMER,
  };
}

export const calculateEcosystemScore = calculateObservationBasedEcosystemHealth;

