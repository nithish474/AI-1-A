import { useMemo } from 'react';
import { BirdSpecies, IUCNStatus, VocalType } from '../types';

export interface FilterableSpecies {
  commonName: string;
  scientificName: string;
  family: string;
  habitat?: string;
  [key: string]: any;
}

/**
 * Shared utility to filter any list of species by a free-text search query.
 * Matches across common name, scientific name, family, and optional habitat.
 */
export function filterSpeciesByQuery<T extends FilterableSpecies>(
  speciesList: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return speciesList;
  }

  return speciesList.filter((item) => {
    const common = item.commonName?.toLowerCase() || '';
    const scientific = item.scientificName?.toLowerCase() || '';
    const family = item.family?.toLowerCase() || '';
    const habitat = item.habitat?.toLowerCase() || '';

    return (
      common.includes(q) ||
      scientific.includes(q) ||
      family.includes(q) ||
      habitat.includes(q)
    );
  });
}

export interface UseSpeciesSearchOptions {
  query?: string;
  iucnStatus?: IUCNStatus | 'ALL';
  vocalType?: VocalType | 'ALL';
  habitatKeyword?: string;
}

/**
 * Reusable React hook for search and multi-facet filtering across species collections.
 */
export function useSpeciesSearch(
  speciesList: BirdSpecies[],
  options: UseSpeciesSearchOptions
): BirdSpecies[] {
  const {
    query = '',
    iucnStatus = 'ALL',
    vocalType = 'ALL',
    habitatKeyword = '',
  } = options;

  return useMemo(() => {
    // 1. Text-based query filter
    let results = filterSpeciesByQuery(speciesList, query);

    // 2. IUCN status filter
    if (iucnStatus && iucnStatus !== 'ALL') {
      results = results.filter((s) => s.iucnStatus === iucnStatus);
    }

    // 3. Vocalization type filter
    if (vocalType && vocalType !== 'ALL') {
      results = results.filter((s) => s.vocalType === vocalType);
    }

    // 4. Habitat specific filter
    if (habitatKeyword && habitatKeyword.trim()) {
      const hq = habitatKeyword.trim().toLowerCase();
      results = results.filter((s) =>
        s.habitat.toLowerCase().includes(hq)
      );
    }

    return results;
  }, [speciesList, query, iucnStatus, vocalType, habitatKeyword]);
}
