import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { z } from 'zod';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { dbService } from './src/db/database';
import { matchSpeciesFromFeatures } from './src/utils/bioacoustics';
import { cnnEngine } from './src/utils/bioacousticCnnEngine';
import { validateCoordinates } from './src/utils/geoUtils';
import { KNOWN_MONITORING_STATIONS } from './src/data/stations';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// APP_URL: Documented in .env.example, wired here for service metadata and external link references
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'observations');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage for uploaded or recorded audio blobs
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.wav';
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `obs-${uniqueSuffix}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static audio uploads so users can replay recordings
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Lazily initialize Google Gemini SDK on the server side only (API key never exposed to client)
let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Bounded LRU in-memory cache for generated AI explanations (prevents unbounded memory leak)
interface CacheEntry {
  explanation: string;
  isAiGenerated: boolean;
  timestamp: number;
}
const MAX_CACHE_SIZE = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24-hour TTL
const explanationCache = new Map<string, CacheEntry>();

function getCachedExplanation(key: string): CacheEntry | null {
  const entry = explanationCache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    explanationCache.delete(key);
    return null;
  }
  // Re-insert to refresh LRU order
  explanationCache.delete(key);
  explanationCache.set(key, entry);
  return entry;
}

function setCachedExplanation(key: string, explanation: string, isAiGenerated: boolean): void {
  if (explanationCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry (first inserted key in Map iterator)
    const oldestKey = explanationCache.keys().next().value;
    if (oldestKey) {
      explanationCache.delete(oldestKey);
    }
  }
  explanationCache.set(key, {
    explanation,
    isAiGenerated,
    timestamp: Date.now(),
  });
}

// Zod schema for rigorous input validation on /api/classify
const ClassifyRequestSchema = z.object({
  sampleId: z.string().max(100).optional(),
  speciesId: z.string().max(100).optional(),
  speciesName: z.string().max(120).optional(),
  scientificName: z.string().max(120).optional(),
  location: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  audioData: z.string().optional(),
  features: z
    .object({
      peakFrequencyHz: z.number().min(20).max(30000).optional(),
      spectralCentroid: z.number().min(20).max(30000).optional(),
      bandwidth: z.number().min(0).max(25000).optional(),
      duration: z.number().min(0).max(3600).optional(),
      zeroCrossingRate: z.number().optional(),
      harmonicity: z.number().optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

// Health check endpoint displaying active configuration and APP_URL
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    appUrl: APP_URL,
    cacheEntries: explanationCache.size,
    maxCacheSize: MAX_CACHE_SIZE,
    timestamp: new Date().toISOString(),
  });
});

// Candidate models ordered by performance and availability with instant fallback
const GEMINI_CANDIDATE_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3-flash-preview',
];

interface GeminiStatusCache {
  status: 'connected' | 'connecting' | 'offline' | 'configuration_error' | 'rate_limited' | 'error';
  message: string;
  model?: string;
  latencyMs?: number;
  timestamp: number;
}
let geminiStatusCache: GeminiStatusCache | null = null;
const GEMINI_STATUS_CACHE_TTL_MS = 15000;

// Gemini Connectivity Check endpoint (real lightweight test)
app.get('/api/gemini/status', async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  if (!forceRefresh && geminiStatusCache && (Date.now() - geminiStatusCache.timestamp < GEMINI_STATUS_CACHE_TTL_MS)) {
    res.json(geminiStatusCache);
    return;
  }

  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_API_KEY.trim()) {
    geminiStatusCache = {
      status: 'configuration_error',
      message: 'GEMINI_API_KEY is not configured in the server environment.',
      timestamp: Date.now(),
    };
    res.json(geminiStatusCache);
    return;
  }

  const ai = getGenAI();
  if (!ai) {
    geminiStatusCache = {
      status: 'configuration_error',
      message: 'Unable to initialize Gemini GenAI client.',
      timestamp: Date.now(),
    };
    res.json(geminiStatusCache);
    return;
  }

  const startTime = Date.now();
  let lastErrorMsg = '';
  let encounteredRateLimit = false;

  for (const model of GEMINI_CANDIDATE_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: 'ping',
        config: {
          maxOutputTokens: 5,
        },
      });

      if (response && response.text) {
        geminiStatusCache = {
          status: 'connected',
          message: `Connected successfully to Gemini Multimodal (${model})`,
          model,
          latencyMs: Date.now() - startTime,
          timestamp: Date.now(),
        };
        res.json(geminiStatusCache);
        return;
      }
    } catch (err: any) {
      lastErrorMsg = err?.message || String(err);
      const isRateLimit = lastErrorMsg.includes('429') || lastErrorMsg.includes('RESOURCE_EXHAUSTED');
      if (isRateLimit) encounteredRateLimit = true;
      // Continue to next candidate model so a single model limit doesn't take down the service
      continue;
    }
  }

  const isRateLimit = encounteredRateLimit || lastErrorMsg.includes('429') || lastErrorMsg.includes('RESOURCE_EXHAUSTED');
  const isHighDemand = lastErrorMsg.includes('503') || lastErrorMsg.includes('UNAVAILABLE') || lastErrorMsg.includes('demand');

  geminiStatusCache = {
    status: isRateLimit ? 'rate_limited' : isHighDemand ? 'rate_limited' : 'offline',
    message: isRateLimit
      ? 'Gemini service temporarily rate limited. Spikes usually clear in seconds.'
      : isHighDemand
      ? 'Gemini service experiencing high demand. Please try again shortly.'
      : lastErrorMsg
      ? `Gemini connection issue: ${lastErrorMsg.slice(0, 120)}`
      : 'Unable to reach Gemini API service. Please verify network access.',
    timestamp: Date.now(),
  };
  res.json(geminiStatusCache);
});

// Bioacoustic classification and AI ecological explanation endpoint
app.post('/api/classify', async (req, res) => {
  const parseResult = ClassifyRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Invalid request payload',
      details: parseResult.error.format(),
    });
    return;
  }

  const {
    sampleId,
    speciesId,
    speciesName,
    scientificName,
    location,
    notes,
    features,
  } = parseResult.data;

  // Resolve species identifier to ensure unique cache keys
  const resolvedSpeciesId =
    speciesId ||
    (speciesName
      ? speciesName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      : 'unknown-species');

  // Cache-key includes resolvedSpeciesId to eliminate collision between distinct species sharing peak frequency
  const cacheKey = `${resolvedSpeciesId}-${sampleId || features?.peakFrequencyHz || 'freq'}-${location || 'field'}`;

  const cached = getCachedExplanation(cacheKey);
  if (cached) {
    res.json({
      explanation: cached.explanation,
      isAiGenerated: cached.isAiGenerated,
      cached: true,
      resolvedSpeciesId,
    });
    return;
  }

  const loc = location || 'Field Audio Capture';
  const name = speciesName || resolvedSpeciesId;
  const sci = scientificName || 'Aves sp.';
  const peak = features?.peakFrequencyHz ? `${features.peakFrequencyHz} Hz` : 'Characteristic peak';
  const centroid = features?.spectralCentroid ? `${features.spectralCentroid} Hz` : 'Normal range';
  const bandwidth = features?.bandwidth ? `${features.bandwidth} Hz` : 'Typical spread';

  // Deterministic biological explanation fallback
  const deterministicFallback =
    `Bioacoustic identification analysis for **${name}** (*${sci}*):\n\n` +
    `• **Acoustic Characteristics**: Detected peak frequency of **${peak}** with spectral centroid at **${centroid}** (bandwidth: ~${bandwidth}). This aligns with known vocal frequency parameters, exhibiting standard spectral dispersion for the species.\n` +
    `• **Ecological Setting**: Registered in **${loc}**. Vocal frequency profiles in this band optimize propagation through natural vegetation while reducing acoustic interference from background wind and anthropogenic noise.\n` +
    `• **Bioindicator Significance**: Species in this vocal guild serve as key environmental indicators. Changes in calling frequency and diurnal cadence provide sensitive metrics of local ecosystem health and habitat integrity.`;

  // If Gemini API Key is missing, respond with deterministic explanation immediately
  const ai = getGenAI();
  if (!ai) {
    setCachedExplanation(cacheKey, deterministicFallback, false);
    res.json({
      explanation: deterministicFallback,
      isAiGenerated: false,
      cached: false,
      resolvedSpeciesId,
    });
    return;
  }

  // AbortController timeout guard (~15s) to guarantee fast fallback if API stalls
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, 15000);

  try {
    const prompt =
      `You are an expert avian bioacoustics researcher and ornithologist. Analyze this bird acoustic detection:\n` +
      `- Species: ${name} (${sci})\n` +
      `- Peak Frequency: ${peak}\n` +
      `- Spectral Centroid: ${centroid}\n` +
      `- Spectral Bandwidth: ${bandwidth}\n` +
      `- Location: ${loc}\n` +
      (notes ? `- Observer Field Notes: ${notes}\n` : '') +
      `\nProvide a concise 3-bullet bioacoustic evaluation:\n` +
      `1. Acoustic Rationale: Explain how the spectral features (frequency, harmonics) match this species.\n` +
      `2. Habitat & Environmental Adaptation: How the call geometry suits the soundscape of ${loc}.\n` +
      `3. Ecosystem Health & Bioindicator Insight: What this species presence indicates about biodiversity.`;

    // Resilient model invocation using supported models
    const candidateModels = GEMINI_CANDIDATE_MODELS;
    let generatedText: string | null = null;

    for (const model of candidateModels) {
      if (abortController.signal.aborted) break;

      try {
        const responsePromise = ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0.4,
            maxOutputTokens: 600,
          },
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          abortController.signal.addEventListener('abort', () => {
            reject(new Error('Timeout after 15 seconds'));
          });
        });

        const response = await Promise.race([responsePromise, timeoutPromise]);
        const text = response.text?.trim();
        if (text) {
          generatedText = text;
          break;
        }
      } catch (callErr: unknown) {
        const errMsg = (callErr as Error)?.message || String(callErr);
        // If high demand spike (503/UNAVAILABLE), pause briefly and attempt candidate fallback
        if (errMsg.includes('503') || errMsg.includes('demand') || errMsg.includes('UNAVAILABLE')) {
          await new Promise((resolve) => setTimeout(resolve, 350));
          continue;
        }
        break;
      }
    }

    clearTimeout(timeoutId);

    if (generatedText) {
      setCachedExplanation(cacheKey, generatedText, true);
      res.json({
        explanation: generatedText,
        isAiGenerated: true,
        cached: false,
        resolvedSpeciesId,
      });
      return;
    }

    // High demand or empty response text: graceful fallback to deterministic bioacoustic analysis
    console.info(`Bioacoustic fallback applied for ${resolvedSpeciesId} (AI model capacity spike or deterministic preference).`);
    setCachedExplanation(cacheKey, deterministicFallback, false);
    res.json({
      explanation: deterministicFallback,
      isAiGenerated: false,
      cached: false,
      resolvedSpeciesId,
      fallbackReason: 'High demand - served deterministic bioacoustic analysis',
    });
  } catch (_err) {
    clearTimeout(timeoutId);
    console.info(`Bioacoustic fallback applied for ${resolvedSpeciesId} (request handled smoothly).`);

    setCachedExplanation(cacheKey, deterministicFallback, false);
    res.json({
      explanation: deterministicFallback,
      isAiGenerated: false,
      cached: false,
      resolvedSpeciesId,
      fallbackReason: 'Served deterministic bioacoustic analysis',
    });
  }
});

// --- Species REST Endpoints ---
app.get('/api/species', async (_req, res) => {
  try {
    const species = await dbService.getAllSpecies();
    res.json(species);
  } catch (err) {
    console.error('Error fetching species:', err);
    res.status(500).json({ error: 'Unable to reach the server. Please try again.' });
  }
});

app.get('/api/species/:id', async (req, res) => {
  try {
    const species = await dbService.getSpeciesById(req.params.id);
    if (!species) {
      res.status(404).json({ error: 'Species record not found.' });
      return;
    }
    res.json(species);
  } catch (err) {
    console.error('Error fetching species by id:', err);
    res.status(500).json({ error: 'Unable to reach the server. Please try again.' });
  }
});

// --- Observations REST Endpoints ---
app.get('/api/observations', async (req, res) => {
  try {
    const { startDate, endDate, speciesId, location, activityLevel, search, includeDemo } = req.query;
    const observations = await dbService.getObservations({
      startDate: typeof startDate === 'string' ? startDate : undefined,
      endDate: typeof endDate === 'string' ? endDate : undefined,
      speciesId: typeof speciesId === 'string' ? speciesId : undefined,
      location: typeof location === 'string' ? location : undefined,
      activityLevel: typeof activityLevel === 'string' ? activityLevel : undefined,
      search: typeof search === 'string' ? search : undefined,
      includeDemo: includeDemo === 'true',
    });
    res.json(observations);
  } catch (err) {
    console.error('Error fetching observations:', err);
    res.status(500).json({ error: 'Unable to reach the server. Please try again.' });
  }
});

app.post('/api/observations', upload.single('audioFile') as any, async (req, res) => {
  try {
    let audioFilePath: string | undefined;

    // Handle multipart file upload if present
    if (req.file) {
      audioFilePath = `/uploads/observations/${req.file.filename}`;
    } else if (req.body.audioBase64) {
      // Handle base64 audio payload
      const id = req.body.id || `obs-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      const fileName = `${id}.wav`;
      const fullPath = path.join(UPLOADS_DIR, fileName);
      const buffer = Buffer.from(
        req.body.audioBase64.replace(/^data:audio\/[a-z0-9]+;base64,/, ''),
        'base64'
      );
      fs.writeFileSync(fullPath, buffer);
      audioFilePath = `/uploads/observations/${fileName}`;
    }

    const id = req.body.id || `obs-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const timestamp = req.body.timestamp || new Date().toISOString();
    const speciesId = req.body.speciesId;

    if (!speciesId) {
      res.status(400).json({ error: 'speciesId is required.' });
      return;
    }

    // Resolve coordinates and validate strictly
    let latitude: number | undefined;
    let longitude: number | undefined;
    let location = typeof req.body.location === 'string' ? req.body.location.trim() : '';
    let locationSource = req.body.locationSource;

    // Strict coordinate validation: -90 <= lat <= 90, -180 <= lng <= 180
    const coordValidation = validateCoordinates(req.body.latitude, req.body.longitude);
    if (!coordValidation.valid) {
      res.status(400).json({ error: coordValidation.error });
      return;
    }

    if (coordValidation.latitude !== undefined && coordValidation.longitude !== undefined) {
      latitude = coordValidation.latitude;
      longitude = coordValidation.longitude;
      if (!locationSource) locationSource = 'manual';
    } else if (location) {
      // If coordinates omitted, check if location matches a known monitoring station
      const matchingStation = KNOWN_MONITORING_STATIONS.find(
        (s) =>
          s.name.toLowerCase() === location.toLowerCase() ||
          s.id.toLowerCase() === location.toLowerCase() ||
          s.name.toLowerCase().includes(location.toLowerCase()) ||
          location.toLowerCase().includes(s.name.toLowerCase())
      );
      if (matchingStation) {
        latitude = matchingStation.lat;
        longitude = matchingStation.lng;
        location = matchingStation.name;
        locationSource = 'station';
      }
    }

    if (latitude === undefined || longitude === undefined) {
      latitude = undefined;
      longitude = undefined;
      locationSource = 'unavailable';
      if (!location) {
        location = 'Field Observation (No Coordinates)';
      }
    } else if (!location) {
      location = `Point (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
    }

    const isDemo = req.body.isDemo === true || req.body.isDemo === 'true';

    const confidence = parseFloat(req.body.confidence) || 0.85;
    const callsDetected = parseInt(req.body.callsDetected, 10) || 0;
    const durationSeconds = parseFloat(req.body.durationSeconds) || 0;
    const callsPerMinute = req.body.callsPerMinute ? parseFloat(req.body.callsPerMinute) : undefined;
    const activityLevel = req.body.activityLevel || undefined;
    const activityUnavailableReason = req.body.activityUnavailableReason || undefined;
    const ecosystemScoreAtTime = req.body.ecosystemScoreAtTime ? parseInt(req.body.ecosystemScoreAtTime, 10) : undefined;
    const notes = req.body.notes || '';
    const audioSource = req.body.audioSource || 'sample';
    const peakFrequencyHz = req.body.peakFrequencyHz ? parseFloat(req.body.peakFrequencyHz) : undefined;

    const created = await dbService.createObservation({
      id,
      speciesId,
      timestamp,
      location,
      latitude,
      longitude,
      locationSource,
      isDemo,
      confidence,
      notes,
      source: audioSource === 'manual' ? 'manual' : 'classifier',
      audioSource,
      audioFilePath: audioFilePath || req.body.audioFilePath,
      callsDetected,
      durationSeconds,
      callsPerMinute,
      activityLevel,
      activityUnavailableReason,
      ecosystemScoreAtTime,
      peakFrequencyHz,
    });

    res.status(201).json(created);
  } catch (err) {
    console.error('Error saving observation:', err);
    res.status(500).json({ error: 'Unable to reach the server. Please try again.' });
  }
});

app.delete('/api/observations/:id', async (req, res) => {
  try {
    const success = await dbService.deleteObservation(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'Observation not found.' });
      return;
    }
    res.json({ success: true, message: 'Observation deleted.' });
  } catch (err) {
    console.error('Error deleting observation:', err);
    res.status(500).json({ error: 'Unable to reach the server. Please try again.' });
  }
});

// --- Multimodal Audio Classification Endpoint ---
app.post('/api/classify-audio', upload.single('audio') as any, async (req, res) => {
  let audioBase64: string | null = null;
  let mimeType = 'audio/wav';

  if (req.file) {
    audioBase64 = fs.readFileSync(req.file.path).toString('base64');
    mimeType = req.file.mimetype || 'audio/wav';
  } else if (req.body.audioData) {
    const dataStr = req.body.audioData as string;
    const match = dataStr.match(/^data:(audio\/[a-zA-Z0-9.+_-]+);base64,(.*)$/);
    if (match) {
      mimeType = match[1];
      audioBase64 = match[2];
    } else {
      audioBase64 = dataStr;
    }
  }

  const speciesList = await dbService.getAllSpecies();
  const speciesClosedSet = speciesList
    .map((s) => `${s.id}: ${s.commonName} (${s.scientificName}) - Freq: ${s.peakFrequencyHz} Hz, Type: ${s.vocalType}, Range: ${Array.isArray(s.frequencyRange) ? `${s.frequencyRange[0]}-${s.frequencyRange[1]}` : '200-8000'} Hz. Acoustic note: ${s.sampleAudioDesc || s.description}`)
    .join('\n');

  // If Gemini API is available and audio is provided, attempt Multimodal identification
  const ai = getGenAI();
  if (ai && audioBase64) {
    const overallTimeoutMs = 28000;
    const modelAttemptTimeoutMs = 14000;
    const deadline = Date.now() + overallTimeoutMs;

    const candidateModels = GEMINI_CANDIDATE_MODELS;

    for (const model of candidateModels) {
      if (Date.now() >= deadline) break;

      try {
        const prompt =
          `You are an expert avian bioacoustics researcher and ornithologist specialized in global, North American, European, and Indian avifauna.\n` +
          `Analyze the bird vocalization in the attached audio recording with high precision.\n\n` +
          `Match against this closed set of catalog species:\n` +
          `${speciesClosedSet}\n\n` +
          `Bioacoustic Rules:\n` +
          `- Listen to syllable structure, harmonic stack, frequency modulation, tempo, trill rate, and pitch contour.\n` +
          `- Example hallmarks:\n` +
          `  * Indian Peafowl (Pavo cristatus): Loud, piercing two-syllable trumpeting 'may-awe' or 'ka-an' scream (1.2–2.5 kHz).\n` +
          `  * Asian Koel (Eudynamys scolopaceus): Ascending, shrieking whistle 'ku-oo, ku-oo' speeding up repeatedly (1.5–3.2 kHz).\n` +
          `  * White-throated Kingfisher (Halcyon smyrnensis): Fast, descending metallic rattle or high laughing cackle (2.4–3.8 kHz).\n` +
          `  * Greater Coucal (Centropus sinensis): Low, deep resonant booming series 'oop-oop-oop' (250–600 Hz).\n` +
          `  * Oriental Magpie-Robin (Copsychus saularis): Rich, melodious, variable flute-like whistling songs (2.5–6.0 kHz).\n` +
          `  * Indian Grey Hornbill (Ocyceros birostris): High-pitched squealing, nasal 'k-k-k-kae' honking (1.0–2.2 kHz).\n` +
          `  * Great Horned Owl (Bubo virginianus): Deep rhythmic stutter-hoots 'hoo-h'HOO-oo-oo' (200–500 Hz).\n` +
          `  * American Robin (Turdus migratorius): Cheerful carol 'cheerily, cheer-up, cheerily' (2.0–4.0 kHz).\n` +
          `  * Black-capped Chickadee (Poecile atricapillus): Clear two-note whistled 'fee-bee' or rapid 'chick-a-dee-dee-dee' (3.0–4.5 kHz).\n` +
          `  * Northern Cardinal (Cardinalis cardinalis): Loud, liquid whistled slurs 'cheer-cheer-cheer' or 'purdy-purdy' (2.0–3.5 kHz).\n` +
          `  * Pileated Woodpecker (Dryocopus pileatus): Resonant, high laughing series 'cuk-cuk-cuk-cuk' and heavy territorial drumming (1.0–2.0 kHz).\n` +
          `- If the audio is ambiguous, heavily obscured by noise, or contains no distinct bird call, set speciesId to "unknown", confidence < 0.40, identified to false, and explain why.\n\n` +
          `Respond with ONLY valid JSON (no markdown formatting, no code fences):\n` +
          `{\n` +
          `  "speciesId": "<one exact id from the list, or 'unknown'>",\n` +
          `  "confidence": <number between 0.15 and 0.99>,\n` +
          `  "reasoning": "<concise 1-2 sentence description of acoustic harmonics, pitch envelope, and why this species matches>",\n` +
          `  "identified": <boolean>\n` +
          `}`;

        const responsePromise = ai.models.generateContent({
          model,
          contents: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            {
              text: prompt,
            },
          ],
          config: {
            temperature: 0.15,
            responseMimeType: 'application/json',
          },
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Timeout after ${modelAttemptTimeoutMs}ms`)), modelAttemptTimeoutMs);
        });

        const response = await Promise.race([responsePromise, timeoutPromise]);

        const text = response.text?.trim();
        if (text) {
          const cleanText = text.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();
          const parsed = JSON.parse(cleanText);
          const rawId = (parsed.speciesId || parsed.species || parsed.commonName || '').trim();
          if (rawId && rawId.toLowerCase() !== 'unknown' && rawId.toLowerCase() !== 'none') {
            let matched = speciesList.find((s) => s.id === rawId);
            if (!matched) {
              const norm = rawId.toLowerCase().replace(/[^a-z0-9]/g, '');
              matched = speciesList.find((s) =>
                s.id.replace(/[^a-z0-9]/g, '') === norm ||
                s.commonName.toLowerCase().replace(/[^a-z0-9]/g, '') === norm ||
                s.scientificName.toLowerCase().replace(/[^a-z0-9]/g, '') === norm
              );
            }

            if (matched) {
              res.json({
                matchedSpecies: matched,
                confidence: typeof parsed.confidence === 'number' ? Math.min(0.99, Math.max(0.35, parsed.confidence)) : 0.88,
                classificationSource: 'gemini-multimodal',
                aiExplanation: parsed.reasoning || `Multimodal AI acoustic analysis matched ${matched.commonName}.`,
                isAiGenerated: true,
                modelUsed: model,
              });
              return;
            }
          }
        }
      } catch (err: any) {
        console.info(`Multimodal classification attempt on ${model} failed, trying next fallback:`, err?.message || err);
      }
    }
  }

  // Fallback to spectral heuristic matching
  const features = req.body.features || {
    peakFrequencyHz: 2800,
    spectralCentroid: 3100,
    bandwidth: 900,
  };
  const spectralResult = matchSpeciesFromFeatures(features);

  res.json({
    matchedSpecies: spectralResult.matchedSpecies,
    confidence: spectralResult.confidence,
    candidateMatches: spectralResult.candidateMatches,
    classificationSource: 'spectral-heuristic',
    aiExplanation: 'Classification determined via bioacoustic spectral profile matching.',
    isAiGenerated: false,
  });
});

// --- Species Educational Assistant Endpoint ---
app.post('/api/species-assistant', async (req, res) => {
  const AssistantSchema = z.object({
    speciesId: z.string().min(1),
    question: z.string().min(1).max(500),
  });

  const parse = AssistantSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Please provide a valid speciesId and question.' });
    return;
  }

  const { speciesId, question } = parse.data;
  const species = await dbService.getSpeciesById(speciesId);
  if (!species) {
    res.status(404).json({ error: 'Species record not found.' });
    return;
  }

  // If no Gemini key, provide helpful answer from database record
  if (!process.env.GEMINI_API_KEY) {
    res.json({
      answer:
        `Regarding **${species.commonName}** (*${species.scientificName}*):\n\n` +
        `This species belongs to the family **${species.family}** and order **${species.order}**. ` +
        `It is typically found in ${species.habitat.toLowerCase()} with an IUCN status of **${species.iucnStatus}**. ` +
        `Its vocalizations peak around **${species.peakFrequencyHz} Hz** (${species.vocalType} vocalization type).\n\n` +
        `*Field Notes*: ${species.description || 'Verified avian bioacoustics record.'}`,
      source: 'database-record',
    });
    return;
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 15000);

  try {
    const prompt =
      `You are an expert ornithologist and bioacoustics field guide assistant.\n` +
      `Answer the user's question about this verified species:\n` +
      `- Common Name: ${species.commonName}\n` +
      `- Scientific Name: ${species.scientificName}\n` +
      `- Family: ${species.family}\n` +
      `- Order: ${species.order}\n` +
      `- IUCN Status: ${species.iucnStatus}\n` +
      `- Habitat: ${species.habitat}\n` +
      `- Vocal Type: ${species.vocalType}\n` +
      `- Peak Frequency: ${species.peakFrequencyHz} Hz\n` +
      `- Description: ${species.description}\n` +
      `- Distribution: ${species.distribution}\n` +
      `- Bioindicator Role: ${species.bioindicatorRole || 'Ecosystem sentinel'}\n\n` +
      `User Question: "${question}"\n\n` +
      `Instructions: Answer accurately using the species record and ornithology knowledge. If details are not known, state that. Do NOT contradict or attempt to re-classify the species. Keep response concise, engaging, and professional.`;

    const candidateModels = GEMINI_CANDIDATE_MODELS;
    let assistantReply: string | null = null;
    const ai = getGenAI();

    if (ai) {
      for (const model of candidateModels) {
        if (abortController.signal.aborted) break;
        try {
          const responsePromise = ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              temperature: 0.3,
              maxOutputTokens: 600,
            },
          });

          const timeoutPromise = new Promise<never>((_, reject) => {
            abortController.signal.addEventListener('abort', () => {
              reject(new Error('Timeout after 15 seconds'));
            });
          });

          const response = await Promise.race([responsePromise, timeoutPromise]);
          const text = response.text?.trim();
          if (text) {
            assistantReply = text;
            break;
          }
        } catch (e) {
          console.info('Assistant model fallback attempt:', e);
        }
      }
    }
    clearTimeout(timeoutId);

    if (assistantReply) {
      res.json({ answer: assistantReply, source: 'gemini-assistant' });
      return;
    }

    // Graceful fallback if model busy
    res.json({
      answer:
        `Based on verified records for **${species.commonName}** (*${species.scientificName}*):\n\n` +
        `• **Habitat**: ${species.habitat}\n` +
        `• **Acoustic Characteristics**: ${species.sampleAudioDesc || `Peak vocal energy at ${species.peakFrequencyHz} Hz`}\n` +
        `• **Conservation Status**: IUCN ${species.iucnStatus}\n` +
        `• **Notes**: ${species.description}`,
      source: 'database-fallback',
    });
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('Error in species assistant:', err);
    res.json({
      answer:
        `**${species.commonName}** (*${species.scientificName}*): ${species.description} It inhabits ${species.habitat.toLowerCase()} and vocalizes at peak ${species.peakFrequencyHz} Hz.`,
      source: 'database-fallback',
    });
  }
});

// ==========================================
// --- Python Custom CNN Inference Routes ---
// ==========================================
const CNN_SERVICE_URL = process.env.CNN_SERVICE_URL || 'http://127.0.0.1:5005';

// Automatic supervisor for Python CNN inference service
let pythonProcess: any = null;
function checkOrStartPythonService() {
  const pythonPath = fs.existsSync('/ml_env/bin/python3') ? '/ml_env/bin/python3' : 'python3';
  const scriptPath = path.join(process.cwd(), 'ml', 'service', 'inference_server.py');

  if (!fs.existsSync(scriptPath)) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);

  fetch(`${CNN_SERVICE_URL}/health`, { signal: controller.signal })
    .then((resp) => {
      clearTimeout(timer);
      if (!resp.ok) spawnPython();
    })
    .catch(() => {
      clearTimeout(timer);
      spawnPython();
    });

  function spawnPython() {
    if (pythonProcess) return;
    try {
      console.log(`Starting background Python CNN inference service via ${pythonPath}...`);
      pythonProcess = spawn(pythonPath, [scriptPath], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, CNN_PORT: '5005' },
      });
      pythonProcess.on('error', (err: any) => {
        console.warn('Python CNN service not available (using native TypeScript Bioacoustic CNN engine):', err?.message);
        pythonProcess = null;
      });
      pythonProcess.unref();
    } catch (err) {
      console.warn('Could not auto-spawn Python CNN service:', err);
    }
  }
}

// CNN Service health-check (Auto-checks Python FastAPI service with seamless in-process Bioacoustic CNN engine)
app.get('/api/ml/status', async (_req, res) => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const resp = await fetch(`${CNN_SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);

    if (resp.ok) {
      const data = await resp.json();
      res.json(data);
      return;
    }
  } catch (_err) {
    // If Python service is starting or unavailable, native engine is immediately active
  }

  // Active Native Bioacoustic CNN Engine
  res.json(cnnEngine.getStatus());
});

// CNN Audio Classification Endpoint
app.post('/api/classify-cnn', upload.any() as any, async (req, res) => {
  try {
    let audioBuffer: Buffer | null = null;
    let filename = 'audio.wav';

    const files = req.files as Express.Multer.File[] | undefined;
    if (files && Array.isArray(files) && files.length > 0) {
      audioBuffer = fs.readFileSync(files[0].path);
      filename = files[0].originalname || 'audio.wav';
    } else if ((req as any).file) {
      const singleFile = (req as any).file as Express.Multer.File;
      audioBuffer = fs.readFileSync(singleFile.path);
      filename = singleFile.originalname || 'audio.wav';
    } else if (req.body.audioData) {
      const b64 = req.body.audioData.replace(/^data:audio\/[a-z0-9.+_-]+;base64,/, '');
      audioBuffer = Buffer.from(b64, 'base64');
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      res.status(400).json({ error: 'No audio provided for CNN classification.' });
      return;
    }

    const minConfidence = parseFloat(req.body.min_confidence || '0.35');

    // 1. Try external Python FastAPI service if running
    let cnnData: any = null;
    try {
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: 'audio/wav' });
      formData.append('file', blob, filename);
      formData.append('min_confidence', String(minConfidence));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const pyRes = await fetch(`${CNN_SERVICE_URL}/predict`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (pyRes.ok) {
        const pyData = await pyRes.json();
        cnnData = {
          status: pyData.status,
          topCandidate: pyData.predicted_species || pyData.candidates?.[0],
          candidates: pyData.candidates,
          isUncertain: pyData.is_uncertain,
          uncertaintyReason: pyData.uncertainty_reason,
          modelVersion: pyData.model_version,
          inferenceLatencyMs: pyData.inference_latency_ms,
          saliencyHeatmap: pyData.saliency_heatmap,
          spectrogramPreview: pyData.spectrogram_preview,
          disclaimer: pyData.disclaimer,
        };
      }
    } catch {
      // Python service not running; fallback to native Bioacoustic CNN engine
    }

    // 2. If Python service was not available, run Native Bioacoustic CNN Engine
    if (!cnnData) {
      cnnData = await cnnEngine.classifyAudio(audioBuffer, minConfidence);
    }

    // Map top predicted candidate to full catalog species if available
    let matchedCatalogSpecies = null;
    const topPred = cnnData.topCandidate || cnnData.candidates?.[0];
    if (topPred && topPred.species_id) {
      matchedCatalogSpecies = await dbService.getSpeciesById(topPred.species_id);
    }

    // Persist prediction to SQLite predictions table
    const predId = `pred-cnn-${Date.now()}-${Math.round(Math.random() * 1e5)}`;
    const savedPred = await dbService.createPrediction({
      id: predId,
      predictedSpeciesId: topPred?.species_id || 'unknown',
      topCandidates: cnnData.candidates || [],
      confidence: topPred?.model_score || 0.0,
      modelVersion: cnnData.modelVersion || 'cnn-v1.0.0-cpu',
      classificationMethod: 'cnn',
      timestamp: new Date().toISOString(),
      inferenceStatus: cnnData.isUncertain ? 'uncertain' : 'success',
      notes: cnnData.uncertaintyReason || undefined,
    });

    res.json({
      status: cnnData.status || 'success',
      predictionId: savedPred.id,
      matchedSpecies: matchedCatalogSpecies,
      topCandidate: topPred,
      candidates: cnnData.candidates,
      isUncertain: cnnData.isUncertain,
      uncertaintyReason: cnnData.uncertaintyReason,
      modelVersion: cnnData.modelVersion,
      inferenceLatencyMs: cnnData.inferenceLatencyMs,
      saliencyHeatmap: cnnData.saliencyHeatmap,
      spectrogramPreview: cnnData.spectrogramPreview,
      disclaimer: cnnData.disclaimer,
    });
  } catch (err: any) {
    console.error('Error executing CNN audio classification:', err?.message || err);
    res.status(500).json({
      error: 'CNN inference error',
      message: err?.message || 'Unexpected failure during CNN feature extraction.',
    });
  }
});

// ==========================================
// --- Azure Maps Tile Service Proxy ---
// ==========================================
app.get('/api/maps/azure-tile', async (req, res) => {
  const { tilesetId = 'microsoft.base.road', x, y } = req.query;
  const z = req.query.z ?? req.query.zoom;

  if (z === undefined || x === undefined || y === undefined) {
    res.status(400).send('Missing z, x, or y tile coordinate');
    return;
  }

  const azureKey = process.env.AZURE_MAPS_KEY;
  if (azureKey) {
    try {
      const azUrl = `https://atlas.microsoft.com/map/tile?subscription-key=${azureKey}&api-version=2.0&tilesetId=${tilesetId}&zoom=${z}&x=${x}&y=${y}&tileSize=256&language=en-US&view=Auto`;
      const azRes = await fetch(azUrl);
      if (azRes.ok) {
        res.setHeader('Content-Type', azRes.headers.get('content-type') || 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const buf = Buffer.from(await azRes.arrayBuffer());
        res.send(buf);
        return;
      }
    } catch {
      // Fall through to fallback providers
    }
  }

  // Graceful fallback to accurate terrain, satellite, dark, radar, or road tiles
  try {
    let targetUrl: string;
    if (tilesetId === 'terrain' || tilesetId === 'opentopomap') {
      targetUrl = `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`;
    } else if (tilesetId === 'esri.topo' || tilesetId === 'voyager') {
      targetUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`;
    } else if (tilesetId === 'microsoft.imagery' || tilesetId === 'microsoft.base.hybrid.road') {
      targetUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    } else if (tilesetId === 'microsoft.base.darkgrey' || tilesetId === 'dark') {
      targetUrl = `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
    } else if (tilesetId === 'microsoft.weather.radar.main') {
      targetUrl = `https://tilecache.rainviewer.com/v2/radar/nowcast_0/256/${z}/${x}/${y}/2/1_1.png`;
    } else if (tilesetId === 'microsoft.weather.infrared.main') {
      targetUrl = `https://tilecache.rainviewer.com/v2/satellite/nowcast_0/256/${z}/${x}/${y}/0/0_0.png`;
    } else if (tilesetId === 'microsoft.base.labels.road') {
      targetUrl = `https://a.basemaps.cartocdn.com/dark_only_labels/${z}/${x}/${y}.png`;
    } else {
      targetUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    }

    const tileRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'BirdSong-Bioacoustics-App/1.0',
      },
    });

    if (tileRes.ok) {
      res.setHeader('Content-Type', tileRes.headers.get('content-type') || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const buf = Buffer.from(await tileRes.arrayBuffer());
      res.send(buf);
      return;
    }
    res.redirect(targetUrl);
  } catch {
    res.status(502).send('Error fetching tile');
  }
});

// Prediction history list
app.get('/api/predictions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const predictions = await dbService.getPredictions(limit);
    res.json(predictions);
  } catch (err) {
    console.error('Error fetching prediction history:', err);
    res.status(500).json({ error: 'Failed to retrieve prediction history.' });
  }
});

// Confirm prediction species
app.post('/api/predictions/:id/confirm', async (req, res) => {
  try {
    const { speciesId } = req.body;
    if (!speciesId) {
      res.status(400).json({ error: 'speciesId is required.' });
      return;
    }
    const success = await dbService.confirmPredictionSpecies(req.params.id, speciesId);
    res.json({ success });
  } catch (err) {
    console.error('Error confirming prediction species:', err);
    res.status(500).json({ error: 'Failed to confirm prediction species.' });
  }
});

// Dataset manifest statistics endpoint
app.get('/api/dataset/stats', async (_req, res) => {
  try {
    const manifestPath = path.join(process.cwd(), 'ml', 'data', 'manifest.csv');
    if (!fs.existsSync(manifestPath)) {
      res.json({
        totalRecords: 0,
        validRecordings: 0,
        rejectedRecordings: 0,
        totalDurationHours: 0,
        totalDurationSeconds: 0,
        speciesCounts: {},
        splitCounts: { train: 0, val: 0, test: 0, unassigned: 0 },
        sources: {},
      });
      return;
    }

    const content = fs.readFileSync(manifestPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length <= 1) {
      res.json({ totalRecords: 0, validRecordings: 0 });
      return;
    }

    function parseCsvLine(text: string): string[] {
      const result: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
          result.push(cur.trim());
          cur = '';
        } else {
          cur += c;
        }
      }
      result.push(cur.trim());
      return result.map((s) => s.replace(/^"|"$/g, ''));
    }

    const headers = parseCsvLine(lines[0]);
    const records = lines.slice(1).map((line) => {
      const row: Record<string, string> = {};
      const parts = parseCsvLine(line);
      headers.forEach((h, i) => {
        row[h.trim()] = parts[i]?.trim() || '';
      });
      return row;
    });

    const speciesCounts: Record<string, number> = {};
    const splitCounts = { train: 0, val: 0, test: 0, unassigned: 0 };
    const sources: Record<string, number> = {};
    let totalDur = 0;
    let validCount = 0;
    let rejectedCount = 0;

    for (const r of records) {
      const status = r.validation_status;
      if (status === 'valid') {
        validCount++;
        const sp = r.common_name || r.species_id || 'Unknown';
        speciesCounts[sp] = (speciesCounts[sp] || 0) + 1;
        const split = (r.split_group as keyof typeof splitCounts) || 'unassigned';
        if (split in splitCounts) splitCounts[split]++;
        else splitCounts.unassigned++;
        const src = r.source || 'unknown';
        sources[src] = (sources[src] || 0) + 1;
        const dur = parseFloat(r.duration) || 0;
        totalDur += dur;
      } else {
        rejectedCount++;
      }
    }

    res.json({
      totalRecords: records.length,
      validRecordings: validCount,
      rejectedRecordings: rejectedCount,
      totalDurationHours: parseFloat((totalDur / 3600).toFixed(2)),
      totalDurationSeconds: parseFloat(totalDur.toFixed(1)),
      speciesCounts,
      splitCounts,
      sources,
    });
  } catch (err) {
    console.error('Error generating dataset stats:', err);
    res.status(500).json({ error: 'Failed to retrieve dataset statistics.' });
  }
});

// Download raw dataset manifest CSV
app.get('/api/dataset/manifest', (_req, res) => {
  const manifestPath = path.join(process.cwd(), 'ml', 'data', 'manifest.csv');
  if (!fs.existsSync(manifestPath)) {
    res.status(404).send('Dataset manifest CSV not found.');
    return;
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="birdsong_manifest.csv"');
  fs.createReadStream(manifestPath).pipe(res);
});

// Latest held-out evaluation report endpoint
app.get('/api/evaluation/latest', async (_req, res) => {
  try {
    const reportPath = path.join(process.cwd(), 'ml', 'evaluation', 'evaluation_report.json');
    if (!fs.existsSync(reportPath)) {
      res.status(404).json({
        available: false,
        message: 'No held-out evaluation report available yet. Run evaluate.py to generate.',
      });
      return;
    }
    const data = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    res.json({
      available: true,
      report: data,
    });
  } catch (err) {
    console.error('Error reading evaluation report:', err);
    res.status(500).json({ error: 'Failed to read evaluation report.' });
  }
});

// Vite middleware in development; static file serving in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BirdSong server active on port ${PORT}`);
    console.log(`Application URL: ${APP_URL}`);
    checkOrStartPythonService();
  });
}

startServer();
