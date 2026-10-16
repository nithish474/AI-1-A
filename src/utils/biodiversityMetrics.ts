import { BIRD_SPECIES, BIRD_SPECIES_BY_ID } from '../data/birds';
import { BiodiversityMetrics, Observation } from '../types';

/**
 * Calculates quantitative ecological biodiversity indicators:
 * - Shannon-Wiener Diversity Index (H')
 * - Gini-Simpson Index (1 - D)
 * - Pielou's Evenness (J')
 * - Full 5-tier IUCN Threat Census (LC, NT, VU, EN, CR)
 * - Bioindicator Sensitivity Watchlist
 */
export function calculateBiodiversityMetrics(
  observations: Observation[]
): BiodiversityMetrics {
  const total = observations.length;
  if (total === 0) {
    return {
      totalObservations: 0,
      uniqueSpeciesCount: 0,
      shannonWienerIndex: 0,
      simpsonIndex: 0,
      evennessIndex: 0,
      ecosystemHealthScore: 75, // Baseline
      ecosystemHealth: 'Stable',
      iucnCounts: { LC: 0, NT: 0, VU: 0, EN: 0, CR: 0 },
      bioindicatorAlerts: [],
    };
  }

  // Count occurrences per species
  const countsBySpeciesId = new Map<string, number>();
  for (const obs of observations) {
    const current = countsBySpeciesId.get(obs.speciesId) || 0;
    countsBySpeciesId.set(obs.speciesId, current + 1);
  }

  const uniqueSpeciesCount = countsBySpeciesId.size;

  // Shannon-Wiener: H' = - sum(p_i * ln(p_i))
  let shannon = 0;
  // Simpson: sum(p_i^2)
  let simpsonSum = 0;

  for (const count of countsBySpeciesId.values()) {
    const p = count / total;
    if (p > 0) {
      shannon -= p * Math.log(p);
      simpsonSum += p * p;
    }
  }

  const simpsonIndex = Math.max(0, 1 - simpsonSum);
  const evennessIndex =
    uniqueSpeciesCount > 1 ? shannon / Math.log(uniqueSpeciesCount) : 1;

  // IUCN counts (all 5 tracked tiers)
  const iucnCounts = {
    LC: 0,
    NT: 0,
    VU: 0,
    EN: 0,
    CR: 0,
  };

  const detectedSpeciesIds = new Set(countsBySpeciesId.keys());

  for (const speciesId of detectedSpeciesIds) {
    const species = BIRD_SPECIES_BY_ID.get(speciesId);
    if (species && species.iucnStatus in iucnCounts) {
      iucnCounts[species.iucnStatus]++;
    }
  }

  // High-sensitivity bioindicators status
  const highSensitivitySpecies = BIRD_SPECIES.filter(
    (b) => b.bioindicatorSensitivity === 'High'
  );

  const bioindicatorAlerts = highSensitivitySpecies.slice(0, 6).map((species) => {
    const isPresent = detectedSpeciesIds.has(species.id);
    return {
      speciesId: species.id,
      sensitivity: species.bioindicatorSensitivity,
      status: isPresent ? ('detected' as const) : ('absent' as const),
      message: isPresent
        ? `${species.commonName} acoustic activity confirms intact ${species.habitat.toLowerCase()} microclimate.`
        : `Absence of ${species.commonName} calls may indicate pressure on ${species.habitat.toLowerCase()}.`,
    };
  });

  // Synthesize holistic health score (0 - 100)
  // Weighted: 40% Shannon diversity, 25% High bioindicators presence, 20% Threatened presence, 15% Evenness
  const shannonComponent = Math.min(40, (shannon / 3.0) * 40);
  const detectedHighBio = highSensitivitySpecies.filter((b) =>
    detectedSpeciesIds.has(b.id)
  ).length;
  const bioindicatorComponent = Math.min(25, (detectedHighBio / 4) * 25);
  const threatenedDetected = iucnCounts.VU + iucnCounts.EN + iucnCounts.CR;
  const threatenedComponent = Math.min(20, threatenedDetected * 7);
  const evennessComponent = evennessIndex * 15;

  const rawScore = Math.round(
    shannonComponent + bioindicatorComponent + threatenedComponent + evennessComponent
  );
  const ecosystemHealthScore = Math.max(10, Math.min(99, rawScore));

  let ecosystemHealth: 'Optimal' | 'Stable' | 'Vulnerable' | 'Degraded';
  if (ecosystemHealthScore >= 80) {
    ecosystemHealth = 'Optimal';
  } else if (ecosystemHealthScore >= 60) {
    ecosystemHealth = 'Stable';
  } else if (ecosystemHealthScore >= 40) {
    ecosystemHealth = 'Vulnerable';
  } else {
    ecosystemHealth = 'Degraded';
  }

  return {
    totalObservations: total,
    uniqueSpeciesCount,
    shannonWienerIndex: Math.round(shannon * 100) / 100,
    simpsonIndex: Math.round(simpsonIndex * 100) / 100,
    evennessIndex: Math.round(evennessIndex * 100) / 100,
    ecosystemHealthScore,
    ecosystemHealth,
    iucnCounts,
    bioindicatorAlerts,
  };
}

/**
 * Generates initial realistic observation seed data
 */
export function getInitialObservations(): Observation[] {
  const seedIds = [
    'turdus-migratorius',
    'poecile-atricapillus',
    'cardinalis-cardinalis',
    'melospiza-melodia',
    'dryocopus-pileatus',
    'bubo-virginianus',
    'setophaga-cerulea',
    'tyto-alba',
    'erithacus-rubecula',
    'numenius-arquata',
    'upupa-epops',
    'troglodytes-troglodytes',
  ];

  const stations = [
    { name: 'Pine Ridge Canopy Station', lat: 45.5231, lng: -122.6765 },
    { name: 'Cedar Creek Understory', lat: 45.5345, lng: -122.6892 },
    { name: 'Oak Savannah Edge', lat: 45.5122, lng: -122.6543 },
    { name: 'High Ridge Old Growth', lat: 45.5411, lng: -122.7012 },
    { name: 'Riparian Forest Reserve', lat: 45.5089, lng: -122.6419 },
    { name: 'North Slope Snag Grove', lat: 45.5312, lng: -122.6681 },
  ];

  const now = Date.now();
  return seedIds.map((speciesId, idx) => {
    const species = BIRD_SPECIES_BY_ID.get(speciesId);
    const hoursAgo = (seedIds.length - idx) * 4.5;
    const time = new Date(now - hoursAgo * 3600 * 1000).toISOString();
    const station = stations[idx % stations.length];

    const callsDetected = (idx % 4) * 3 + 4;
    const durationSeconds = 12.0;
    const callsPerMinute = Math.round((callsDetected / durationSeconds) * 60);

    return {
      id: `seed-obs-${idx + 1}`,
      speciesId,
      timestamp: time,
      location: station.name,
      latitude: station.lat,
      longitude: station.lng,
      confidence: Math.round((0.85 + (idx % 12) * 0.01) * 100) / 100,
      notes: `Acoustic detection via high-pass microphone array during ${
        idx % 3 === 0 ? 'dawn chorus' : 'dusk survey'
      }. Match validated at ${station.name}.`,
      source: 'classifier',
      audioSource: 'sample',
      callsDetected,
      durationSeconds,
      callsPerMinute,
      activityLevel: callsPerMinute > 20 ? 'High' : callsPerMinute >= 5 ? 'Moderate' : 'Low',
      peakFrequencyHz: species?.peakFrequencyHz || 3200,
      ecosystemScoreAtTime: 80 + (idx % 15),
    };
  });
}
