import { BirdSpecies, AcousticProfile } from '../types';

let sharedAudioContext: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    sharedAudioContext = new AudioContextClass();
  }
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume();
  }
  return sharedAudioContext;
}

/**
 * Parameterized procedural sound generator.
 * Eliminates monolithic per-species switch statements in favor of reusable,
 * acoustically grounded mathematical synthesis profiles.
 */
export function buildAudioGraph(
  ctx: BaseAudioContext,
  dest: AudioNode,
  profile: AcousticProfile,
  freqRange: [number, number],
  peakHz: number,
  startTime: number,
  duration: number
): { stop: () => void } {
  const [minHz, maxHz] = freqRange;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.001, startTime);
  masterGain.connect(dest);

  const activeNodes: (AudioNode | { stop?: (t?: number) => void })[] = [masterGain];

  switch (profile.synthesisShape) {
    case 'hoot': {
      // Warm, resonant low-frequency fundamental with soft envelope
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(peakHz, startTime);

      // Subtle vibrato
      if (profile.fmModulation && profile.fmModulation > 0) {
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.setValueAtTime(4.5, startTime);
        lfoGain.gain.setValueAtTime(profile.fmModulation, startTime);
        lfo.connect(osc.frequency);
        lfo.start(startTime);
        lfo.stop(startTime + duration);
        activeNodes.push(lfo, lfoGain);
      }

      // Add soft lower harmonics
      if (profile.harmonics > 1) {
        const hOsc = ctx.createOscillator();
        const hGain = ctx.createGain();
        hOsc.type = 'sine';
        hOsc.frequency.setValueAtTime(peakHz * 2, startTime);
        hGain.gain.setValueAtTime(0.18, startTime);
        hOsc.connect(hGain);
        hGain.connect(masterGain);
        hOsc.start(startTime);
        hOsc.stop(startTime + duration);
        activeNodes.push(hOsc, hGain);
      }

      const syllableCount = Math.max(1, Math.round(duration * profile.syllablesPerSec));
      const syllablePeriod = duration / syllableCount;

      for (let i = 0; i < syllableCount; i++) {
        const t0 = startTime + i * syllablePeriod;
        const sylDur = syllablePeriod * 0.75;
        masterGain.gain.setValueAtTime(0.001, t0);
        masterGain.gain.exponentialRampToValueAtTime(0.45, t0 + sylDur * 0.35);
        masterGain.gain.exponentialRampToValueAtTime(0.001, t0 + sylDur);
      }

      osc.connect(masterGain);
      osc.start(startTime);
      osc.stop(startTime + duration);
      activeNodes.push(osc);
      break;
    }

    case 'trill': {
      // Rapid frequency-modulated note pulses
      const osc = ctx.createOscillator();
      osc.type = profile.harmonics > 2 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(minHz, startTime);

      const pulseRate = Math.max(4, profile.syllablesPerSec || 8);
      const pulsePeriod = 1 / pulseRate;
      const numPulses = Math.floor(duration / pulsePeriod);

      for (let i = 0; i < numPulses; i++) {
        const t0 = startTime + i * pulsePeriod;
        const pDur = pulsePeriod * 0.85;

        // Sweep up or down per syllable
        if (profile.sweepType === 'steep' || profile.sweepType === 'convex') {
          osc.frequency.setValueAtTime(minHz, t0);
          osc.frequency.linearRampToValueAtTime(maxHz, t0 + pDur * 0.5);
          osc.frequency.linearRampToValueAtTime(peakHz, t0 + pDur);
        } else {
          osc.frequency.setValueAtTime(maxHz, t0);
          osc.frequency.linearRampToValueAtTime(minHz, t0 + pDur);
        }

        masterGain.gain.setValueAtTime(0.001, t0);
        masterGain.gain.exponentialRampToValueAtTime(0.35, t0 + pDur * 0.2);
        masterGain.gain.exponentialRampToValueAtTime(0.001, t0 + pDur);
      }

      osc.connect(masterGain);
      osc.start(startTime);
      osc.stop(startTime + duration);
      activeNodes.push(osc);
      break;
    }

    case 'warble': {
      // Expressive liquid melodic whistling with continuous pitch contours
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(peakHz, startTime);

      // Vibrant LFO
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.setValueAtTime(6.5, startTime);
      lfoGain.gain.setValueAtTime(profile.fmModulation || 180, startTime);
      lfo.connect(osc.frequency);
      lfo.start(startTime);
      lfo.stop(startTime + duration);
      activeNodes.push(lfo, lfoGain);

      // Smooth multi-point contour
      const steps = 6;
      const stepDur = duration / steps;
      for (let i = 0; i <= steps; i++) {
        const t = startTime + i * stepDur;
        const targetFreq =
          i % 2 === 0
            ? peakHz + (maxHz - peakHz) * 0.7
            : minHz + (peakHz - minHz) * 0.3;
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(100, targetFreq),
          t
        );
      }

      masterGain.gain.setValueAtTime(0.001, startTime);
      masterGain.gain.exponentialRampToValueAtTime(0.38, startTime + 0.08);
      masterGain.gain.setValueAtTime(0.35, startTime + duration - 0.1);
      masterGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(masterGain);
      osc.start(startTime);
      osc.stop(startTime + duration);
      activeNodes.push(osc);
      break;
    }

    case 'screech': {
      // High harmonic density with noise texture (raptors, owls)
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(maxHz, startTime);
      osc.frequency.exponentialRampToValueAtTime(minHz, startTime + duration);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(peakHz, startTime);
      filter.Q.setValueAtTime(2.5, startTime);

      // Synthetic noise component for raspiness
      const noiseBuffer = ctx.createBuffer(
        1,
        Math.floor(ctx.sampleRate * duration),
        ctx.sampleRate
      );
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (profile.noiseRatio || 0.4);
      }
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.2, startTime);
      noiseSource.connect(noiseGain);
      noiseGain.connect(filter);

      osc.connect(filter);
      filter.connect(masterGain);

      masterGain.gain.setValueAtTime(0.001, startTime);
      masterGain.gain.exponentialRampToValueAtTime(0.3, startTime + 0.05);
      masterGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.start(startTime);
      osc.stop(startTime + duration);
      noiseSource.start(startTime);
      noiseSource.stop(startTime + duration);
      activeNodes.push(osc, filter, noiseSource, noiseGain);
      break;
    }

    case 'staccato': {
      // Rapid percussive clicks or drumming hits (woodpeckers, corvids, storks)
      const isDrumming = minHz < 1000;
      const hitRate = Math.max(3, profile.syllablesPerSec || 8);
      const period = 1 / hitRate;
      const count = Math.floor(duration / period);

      for (let i = 0; i < count; i++) {
        const t0 = startTime + i * period;
        const hitOsc = ctx.createOscillator();
        const hitGain = ctx.createGain();

        hitOsc.type = isDrumming ? 'triangle' : 'square';
        hitOsc.frequency.setValueAtTime(peakHz, t0);
        hitOsc.frequency.exponentialRampToValueAtTime(
          Math.max(80, peakHz * 0.4),
          t0 + period * 0.4
        );

        hitGain.gain.setValueAtTime(0.001, t0);
        hitGain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.005);
        hitGain.gain.exponentialRampToValueAtTime(0.001, t0 + period * 0.6);

        hitOsc.connect(hitGain);
        hitGain.connect(masterGain);

        hitOsc.start(t0);
        hitOsc.stop(t0 + period);
        activeNodes.push(hitOsc, hitGain);
      }

      masterGain.gain.setValueAtTime(0.8, startTime);
      break;
    }

    case 'chirp':
    default: {
      // Crisp directional pitch sweep with fast envelope
      const osc = ctx.createOscillator();
      osc.type = profile.harmonics > 1 ? 'triangle' : 'sine';

      const calls = Math.max(1, Math.round(duration * (profile.syllablesPerSec || 2)));
      const sylPeriod = duration / calls;

      for (let i = 0; i < calls; i++) {
        const t0 = startTime + i * sylPeriod;
        const sylDur = sylPeriod * 0.7;

        if (profile.sweepType === 'concave') {
          osc.frequency.setValueAtTime(maxHz, t0);
          osc.frequency.exponentialRampToValueAtTime(minHz, t0 + sylDur);
        } else if (profile.sweepType === 'convex') {
          osc.frequency.setValueAtTime(minHz, t0);
          osc.frequency.exponentialRampToValueAtTime(maxHz, t0 + sylDur);
        } else {
          osc.frequency.setValueAtTime(peakHz, t0);
          osc.frequency.linearRampToValueAtTime(minHz, t0 + sylDur);
        }

        masterGain.gain.setValueAtTime(0.001, t0);
        masterGain.gain.exponentialRampToValueAtTime(0.38, t0 + sylDur * 0.15);
        masterGain.gain.exponentialRampToValueAtTime(0.001, t0 + sylDur);
      }

      osc.connect(masterGain);
      osc.start(startTime);
      osc.stop(startTime + duration);
      activeNodes.push(osc);
      break;
    }
  }

  return {
    stop: () => {
      try {
        masterGain.gain.setValueAtTime(0, ctx.currentTime);
        activeNodes.forEach((node) => {
          if ('stop' in node && typeof node.stop === 'function') {
            node.stop();
          }
        });
      } catch {
        // Safe disposal
      }
    },
  };
}

/**
 * Live audio audition for interactive UI buttons
 */
export async function playBirdCall(
  species: BirdSpecies,
  durationSec = 2.4
): Promise<() => void> {
  const ctx = getAudioContext();
  const startTime = ctx.currentTime + 0.05;
  const handle = buildAudioGraph(
    ctx,
    ctx.destination,
    species.acousticProfile,
    species.frequencyRange,
    species.peakFrequencyHz,
    startTime,
    durationSec
  );

  return () => {
    handle.stop();
  };
}

/**
 * Offline rendering into an AudioBuffer for FFT extraction, spectrograms, and test suites
 */
export async function renderBirdCallBuffer(
  species: BirdSpecies,
  durationSec = 2.0,
  sampleRate = 44100
): Promise<AudioBuffer> {
  const OfflineAudioContextClass =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;

  const offlineCtx = new OfflineAudioContextClass(
    1,
    Math.floor(sampleRate * durationSec),
    sampleRate
  );

  buildAudioGraph(
    offlineCtx,
    offlineCtx.destination,
    species.acousticProfile,
    species.frequencyRange,
    species.peakFrequencyHz,
    0,
    durationSec
  );

  return offlineCtx.startRendering();
}
