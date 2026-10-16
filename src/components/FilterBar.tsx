import React from 'react';
import { Search, X, RotateCcw } from 'lucide-react';

export interface FilterBarProps {
  search?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;

  // Generic filter dropdowns
  dropdowns?: {
    id: string;
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (val: string) => void;
  }[];

  // Date range inputs (optional)
  dateRange?: {
    startDate?: string;
    endDate?: string;
    onStartDateChange: (val: string) => void;
    onEndDateChange: (val: string) => void;
  };

  // Status & Counts
  totalCount?: number;
  filteredCount?: number;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  search,
  onSearchChange,
  searchPlaceholder = 'Search...',
  dropdowns = [],
  dateRange,
  totalCount,
  filteredCount,
  onClearFilters,
  hasActiveFilters,
}) => {
  return (
    <div id="filter-bar-container" className="bg-slate-900/60 border border-emerald-500/20 rounded-xl p-4 backdrop-blur-sm mb-6">
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 justify-between">
        {/* Left: Search input */}
        {onSearchChange !== undefined && (
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400/60" />
            <input
              id="filter-search-input"
              type="text"
              value={search || ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-10 pr-9 py-2 bg-slate-950/70 border border-emerald-500/25 rounded-lg text-sm text-emerald-100 placeholder-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400 transition"
            />
            {search && (
              <button
                id="clear-search-btn"
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-300 p-1"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Middle: Dropdown selects */}
        <div className="flex flex-wrap items-center gap-2.5">
          {dropdowns.map((d) => (
            <div key={d.id} className="flex items-center gap-1.5">
              <label htmlFor={`filter-select-${d.id}`} className="text-xs text-emerald-300/70 font-medium whitespace-nowrap">
                {d.label}:
              </label>
              <select
                id={`filter-select-${d.id}`}
                value={d.value}
                onChange={(e) => d.onChange(e.target.value)}
                className="bg-slate-950/70 border border-emerald-500/25 rounded-lg text-xs py-2 px-2.5 text-emerald-100 focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400 transition cursor-pointer"
              >
                {d.options.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-slate-900 text-emerald-100">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {/* Date range filters if provided */}
          {dateRange && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="text-xs text-emerald-300/70 font-medium">From:</span>
                <input
                  id="filter-start-date"
                  type="date"
                  value={dateRange.startDate || ''}
                  onChange={(e) => dateRange.onStartDateChange(e.target.value)}
                  className="bg-slate-950/70 border border-emerald-500/25 rounded-lg text-xs py-1.5 px-2 text-emerald-100 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-emerald-300/70 font-medium">To:</span>
                <input
                  id="filter-end-date"
                  type="date"
                  value={dateRange.endDate || ''}
                  onChange={(e) => dateRange.onEndDateChange(e.target.value)}
                  className="bg-slate-950/70 border border-emerald-500/25 rounded-lg text-xs py-1.5 px-2 text-emerald-100 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                />
              </div>
            </div>
          )}

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              id="clear-all-filters-btn"
              onClick={onClearFilters}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition shadow-sm"
              title="Reset all filters"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear Filters</span>
            </button>
          )}
        </div>
      </div>

      {/* Item count status row */}
      {(totalCount !== undefined || filteredCount !== undefined) && (
        <div className="mt-2.5 pt-2.5 border-t border-emerald-500/15 flex items-center justify-between text-xs text-slate-400">
          <span>
            Showing <strong className="text-emerald-300">{filteredCount ?? totalCount}</strong> of{' '}
            <strong className="text-slate-300">{totalCount}</strong> records
          </span>
          {hasActiveFilters && (
            <span className="text-emerald-400/80 font-medium">Filters active</span>
          )}
        </div>
      )}
    </div>
  );
};

export const NoResultsEmptyState: React.FC<{ onClear?: () => void; message?: string }> = ({
  onClear,
  message = 'No results found matching the selected filters.',
}) => (
  <div id="no-results-state" className="flex flex-col items-center justify-center p-12 text-center bg-slate-900/40 border border-dashed border-emerald-500/20 rounded-2xl my-6">
    <Search className="w-10 h-10 text-emerald-400/40 mb-3" />
    <p className="text-base text-emerald-200/90 font-medium mb-1">{message}</p>
    <p className="text-xs text-slate-400 mb-4">Try clearing or broadening your search parameters.</p>
    {onClear && (
      <button
        id="no-results-clear-btn"
        onClick={onClear}
        className="px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-medium transition"
      >
        Clear Filters
      </button>
    )}
  </div>
);
