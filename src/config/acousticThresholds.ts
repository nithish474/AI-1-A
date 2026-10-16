/**
 * Acoustic Analysis and Call Detection Configuration
 * Tunable parameters for short-time energy envelopes, noise floor derivation,
 * syllable merging, and acoustic activity band classification.
 */

export const ACOUSTIC_THRESHOLDS = {
  // Short-time RMS window size in milliseconds (~50ms window)
  windowSizeMs: 50,

  // Window hop size in milliseconds (~25ms overlap)
  hopSizeMs: 25,

  // Percentile of quietest windows used to estimate background noise floor
  noiseFloorPercentile: 0.20,

  // Multiplier for noise floor standard deviation (noiseFloor = mean + k * stdDev)
  noiseFloorStdDevMultiplierK: 1.5,

  // Minimum gap between syllables (ms) to merge into a single call event
  minCallGapMs: 100,

  // Minimum duration of an event (ms) to qualify as a valid bird call
  minCallDurationMs: 80,

  // Minimum audio duration (seconds) required to compute calls/minute activity estimation
  minClipLengthForActivitySeconds: 3.0,
};

/**
 * Acoustic Activity Level Classification Bands
 * Classify strictly from calls_per_minute against these boundaries.
 */
export const ACTIVITY_THRESHOLDS = {
  lowMaxCallsPerMinute: 5,     // < this => Low
  moderateMaxCallsPerMinute: 15, // < this => Moderate, else High
};
