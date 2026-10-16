import { BirdSpecies, Observation, IUCNStatus, BioindicatorSensitivity } from '../types';

export interface SpeciesFilters {
  search?: string;
  family?: string;
  habitat?: string;
  iucnStatus?: string;
  sensitivity?: string;
}

export interface ObservationFilters {
  startDate?: string;
  endDate?: string;
  speciesId?: string;
  location?: string;
  activityLevel?: string;
  search?: string;
}

/**
 * Filter species array by search, family, habitat, IUCN status, and bioindicator sensitivity
 */
export function filterSpecies(speciesList: BirdSpecies[], filters: SpeciesFilters): BirdSpecies[] {
  return speciesList.filter((sp) => {
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      const matchName = sp.commonName.toLowerCase().includes(q);
      const matchSci = sp.scientificName.toLowerCase().includes(q);
      const matchFamily = sp.family.toLowerCase().includes(q);
      const matchHabitat = sp.habitat.toLowerCase().includes(q);
      const matchVocal = sp.vocalType.toLowerCase().includes(q);
      if (!matchName && !matchSci && !matchFamily && !matchHabitat && !matchVocal) {
        return false;
      }
    }

    if (filters.family && filters.family !== 'all' && sp.family !== filters.family) {
      return false;
    }

    if (filters.habitat && filters.habitat !== 'all') {
      if (!sp.habitat.toLowerCase().includes(filters.habitat.toLowerCase())) {
        return false;
      }
    }

    if (filters.iucnStatus && filters.iucnStatus !== 'all' && sp.iucnStatus !== filters.iucnStatus) {
      return false;
    }

    if (filters.sensitivity && filters.sensitivity !== 'all') {
      if (sp.bioindicatorSensitivity !== filters.sensitivity) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Filter observations client-side (or for cache-aside filtering)
 */
export function filterObservations(
  observations: Observation[],
  filters: ObservationFilters,
  speciesMap?: Map<string, BirdSpecies>
): Observation[] {
  return observations.filter((obs) => {
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      const sp = speciesMap?.get(obs.speciesId);
      const matchSpName = sp ? sp.commonName.toLowerCase().includes(q) : false;
      const matchNotes = obs.notes.toLowerCase().includes(q);
      const matchLoc = (obs.location || '').toLowerCase().includes(q);
      const matchSpId = obs.speciesId.toLowerCase().includes(q);
      if (!matchSpName && !matchNotes && !matchLoc && !matchSpId) {
        return false;
      }
    }

    if (filters.speciesId && filters.speciesId !== 'all' && obs.speciesId !== filters.speciesId) {
      return false;
    }

    if (filters.location && filters.location !== 'all') {
      if (!(obs.location || '').toLowerCase().includes(filters.location.toLowerCase())) {
        return false;
      }
    }

    if (filters.activityLevel && filters.activityLevel !== 'all') {
      if (obs.activityLevel !== filters.activityLevel) {
        return false;
      }
    }

    if (filters.startDate) {
      const obsTime = new Date(obs.timestamp).getTime();
      const startTime = new Date(filters.startDate).getTime();
      if (obsTime < startTime) return false;
    }

    if (filters.endDate) {
      const obsTime = new Date(obs.timestamp).getTime();
      const endTime = new Date(filters.endDate).getTime();
      if (obsTime > endTime) return false;
    }

    return true;
  });
}

/**
 * Serializes observation filter object to query parameters matching GET /api/observations
 */
export function serializeObservationParams(filters: ObservationFilters): string {
  const params = new URLSearchParams();
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.speciesId && filters.speciesId !== 'all') params.set('speciesId', filters.speciesId);
  if (filters.location && filters.location !== 'all') params.set('location', filters.location);
  if (filters.activityLevel && filters.activityLevel !== 'all') params.set('activityLevel', filters.activityLevel);
  if (filters.search) params.set('search', filters.search);
  return params.toString();
}

/**
 * Extracts unique families from loaded species
 */
export function getDistinctFamilies(speciesList: BirdSpecies[]): string[] {
  const set = new Set<string>();
  for (const s of speciesList) {
    if (s.family) set.add(s.family);
  }
  return Array.from(set).sort();
}

/**
 * Extracts unique habitats from loaded species
 */
export function getDistinctHabitats(speciesList: BirdSpecies[]): string[] {
  const set = new Set<string>();
  for (const s of speciesList) {
    if (s.habitat) {
      const parts = s.habitat.split(',').map((p) => p.trim());
      parts.forEach((p) => {
        if (p) set.add(p);
      });
    }
  }
  return Array.from(set).sort();
}

/**
 * Extracts unique locations from loaded observations
 */
export function getDistinctLocations(observations: Observation[]): string[] {
  const set = new Set<string>();
  for (const o of observations) {
    if (o.location && o.location.trim()) {
      set.add(o.location.trim());
    }
  }
  return Array.from(set).sort();
}
