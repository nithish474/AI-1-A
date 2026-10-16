import initSqlJs, { Database } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { BIRD_SPECIES } from '../data/birds';
import { BirdSpecies, Observation, PredictionRecord } from '../types';

const DB_PATH = path.join(process.cwd(), 'birdsong.sqlite');
const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'observations');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export class DatabaseService {
  private db: Database | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.init();
  }

  public async ensureReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.init();
    }
    await this.initPromise;
  }

  private persistToFile(): void {
    if (!this.db) return;
    try {
      const data = this.db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (err) {
      console.error('Error persisting SQLite database to disk:', err);
    }
  }

  private run(sql: string, params: unknown[] = []): { changes: number } {
    if (!this.db) throw new Error('Database not initialized');
    const normalized = params.map((p) => (p === undefined ? null : p));
    this.db.run(sql, normalized as any);
    const changes = this.db.getRowsModified();
    this.persistToFile();
    return { changes };
  }

  private get<T>(sql: string, params: unknown[] = []): T | undefined {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare(sql);
    if (params && params.length > 0) {
      const normalized = params.map((p) => (p === undefined ? null : p));
      stmt.bind(normalized as any);
    }
    let result: T | undefined = undefined;
    if (stmt.step()) {
      result = stmt.getAsObject() as T;
    }
    stmt.free();
    return result;
  }

  private all<T>(sql: string, params: unknown[] = []): T[] {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare(sql);
    if (params && params.length > 0) {
      const normalized = params.map((p) => (p === undefined ? null : p));
      stmt.bind(normalized as any);
    }
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  private exec(sql: string): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.exec(sql);
    this.persistToFile();
  }

  private async init() {
    try {
      const SQL = await initSqlJs();

      if (fs.existsSync(DB_PATH)) {
        try {
          const fileBuffer = fs.readFileSync(DB_PATH);
          this.db = new SQL.Database(fileBuffer);
          console.info('Loaded existing SQLite database from', DB_PATH);
        } catch (readErr) {
          console.warn('Failed to read existing DB file, creating fresh database:', readErr);
          this.db = new SQL.Database();
        }
      } else {
        this.db = new SQL.Database();
        console.info('Created new SQLite database in memory, will persist to', DB_PATH);
      }

      // 1. Create tables
      this.exec(`
        CREATE TABLE IF NOT EXISTS species (
          id TEXT PRIMARY KEY,
          commonName TEXT NOT NULL,
          scientificName TEXT NOT NULL,
          family TEXT NOT NULL,
          orderName TEXT NOT NULL,
          iucnStatus TEXT NOT NULL,
          habitat TEXT NOT NULL,
          bioindicatorSensitivity TEXT NOT NULL,
          sensitivityScore INTEGER NOT NULL,
          minFrequencyHz INTEGER NOT NULL,
          maxFrequencyHz INTEGER NOT NULL,
          peakFrequencyHz INTEGER NOT NULL,
          vocalType TEXT NOT NULL,
          description TEXT,
          diet TEXT,
          bioindicatorRole TEXT,
          distribution TEXT,
          sampleAudioDesc TEXT,
          identificationTips TEXT,
          threats TEXT,
          acousticProfile TEXT,
          imageUrl TEXT
        );

        CREATE TABLE IF NOT EXISTS observations (
          id TEXT PRIMARY KEY,
          speciesId TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          location TEXT,
          latitude REAL,
          longitude REAL,
          confidence REAL NOT NULL,
          audioSource TEXT NOT NULL,
          audioFilePath TEXT,
          callsDetected INTEGER NOT NULL DEFAULT 0,
          durationSeconds REAL NOT NULL DEFAULT 0,
          callsPerMinute REAL,
          activityLevel TEXT,
          activityUnavailableReason TEXT,
          ecosystemScoreAtTime INTEGER,
          notes TEXT,
          peakFrequencyHz REAL,
          locationSource TEXT,
          isDemo INTEGER DEFAULT 0,
          FOREIGN KEY (speciesId) REFERENCES species(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_obs_timestamp ON observations(timestamp);
        CREATE INDEX IF NOT EXISTS idx_obs_speciesId ON observations(speciesId);
        CREATE INDEX IF NOT EXISTS idx_obs_location ON observations(location);
        CREATE INDEX IF NOT EXISTS idx_obs_activityLevel ON observations(activityLevel);

        CREATE TABLE IF NOT EXISTS predictions (
          id TEXT PRIMARY KEY,
          observationId TEXT,
          recordingId TEXT,
          predictedSpeciesId TEXT NOT NULL,
          topCandidates TEXT NOT NULL,
          confidence REAL NOT NULL,
          modelVersion TEXT NOT NULL,
          classificationMethod TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          inferenceStatus TEXT NOT NULL,
          userConfirmedSpeciesId TEXT,
          notes TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_pred_timestamp ON predictions(timestamp);
        CREATE INDEX IF NOT EXISTS idx_pred_speciesId ON predictions(predictedSpeciesId);
      `);

      // 2. Backward-compatible schema migration for existing SQLite databases
      const colInfo = this.all<{ name: string }>('PRAGMA table_info(observations)');
      const colNames = new Set(colInfo.map((c) => c.name));
      if (!colNames.has('isDemo')) {
        this.exec('ALTER TABLE observations ADD COLUMN isDemo INTEGER DEFAULT 0');
      }
      if (!colNames.has('locationSource')) {
        this.exec('ALTER TABLE observations ADD COLUMN locationSource TEXT');
      }

      // Safe index creation on migrated isDemo column
      this.exec('CREATE INDEX IF NOT EXISTS idx_obs_isDemo ON observations(isDemo);');

      // Mark legacy seed observations as demonstration records
      this.exec("UPDATE observations SET isDemo = 1 WHERE id LIKE 'obs-seed-%' OR id LIKE 'seed-obs-%'");

      // If user's previously saved observation in Bengaluru exists with null coordinates, update to authentic coordinates
      this.exec(`
        UPDATE observations 
        SET latitude = 12.9716, 
            longitude = 77.5946, 
            location = 'Bengaluru Bioacoustic Observatory', 
            locationSource = 'station', 
            isDemo = 0 
        WHERE (location LIKE '%bengaluru%' OR location LIKE '%benguluru%') 
          AND (latitude IS NULL OR latitude = 0);
      `);

      // 3. Seed species from curated BIRD_SPECIES with species-specific images
      console.info(`Synchronizing ${BIRD_SPECIES.length} curated bird species into SQLite...`);
      for (const bird of BIRD_SPECIES) {
        const sensitivityScore =
          bird.bioindicatorSensitivity === 'High'
            ? 8
            : bird.bioindicatorSensitivity === 'Moderate'
            ? 5
            : 3;

        const defaultBioRole =
          bird.bioindicatorSensitivity === 'High'
            ? `High-sensitivity sentinel species whose acoustic presence indicates mature ${bird.habitat.toLowerCase()} microclimate and intact trophic webs.`
            : bird.bioindicatorSensitivity === 'Moderate'
            ? `Secondary bioindicator monitoring canopy balance and food-web resilience in ${bird.habitat.toLowerCase()}.`
            : `Broad-niche generalist adaptable to human-disturbed habitats.`;

        const imageUrl = bird.imageUrl || `/images/birds/${bird.id}.jpg`;

        const existing = this.get<{ id: string }>('SELECT id FROM species WHERE id = ?', [bird.id]);
        if (!existing) {
          this.run(
            `INSERT INTO species (
              id, commonName, scientificName, family, orderName, iucnStatus,
              habitat, bioindicatorSensitivity, sensitivityScore, minFrequencyHz,
              maxFrequencyHz, peakFrequencyHz, vocalType, description, diet,
              bioindicatorRole, distribution, sampleAudioDesc, identificationTips,
              threats, acousticProfile, imageUrl
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              bird.id,
              bird.commonName,
              bird.scientificName,
              bird.family,
              bird.order,
              bird.iucnStatus,
              bird.habitat,
              bird.bioindicatorSensitivity,
              sensitivityScore,
              bird.frequencyRange[0],
              bird.frequencyRange[1],
              bird.peakFrequencyHz,
              bird.vocalType,
              bird.description || null,
              null,
              defaultBioRole,
              bird.distribution || null,
              bird.sampleAudioDesc || null,
              JSON.stringify(bird.identificationTips || []),
              JSON.stringify(bird.threats || []),
              JSON.stringify(bird.acousticProfile || {}),
              imageUrl,
            ]
          );
        } else {
          // Update imageUrl, acousticProfile, and frequency data
          this.run(
            `UPDATE species SET 
              imageUrl = ?,
              acousticProfile = ?,
              minFrequencyHz = ?,
              maxFrequencyHz = ?,
              peakFrequencyHz = ?,
              vocalType = ?
            WHERE id = ?`,
            [
              imageUrl,
              JSON.stringify(bird.acousticProfile || {}),
              bird.frequencyRange[0],
              bird.frequencyRange[1],
              bird.peakFrequencyHz,
              bird.vocalType,
              bird.id,
            ]
          );
        }
      }
      console.info('Species table synchronized successfully with accurate species-specific image paths.');

      // 3. Seed initial baseline observations if empty so the map and analytics work on first load
      const obsCount = this.get<{ count: number }>('SELECT COUNT(*) as count FROM observations');
      if (!obsCount || obsCount.count === 0) {
        console.info('Seeding initial baseline observations into SQLite...');
        const initialSeeds = [
          {
            id: 'obs-seed-1',
            speciesId: 'turdus-migratorius',
            timestamp: new Date(Date.now() - 3600 * 1000 * 48).toISOString(),
            location: 'Pine Ridge Canopy Station',
            latitude: 45.5231,
            longitude: -122.6765,
            confidence: 0.94,
            audioSource: 'sample',
            callsDetected: 14,
            durationSeconds: 60,
            callsPerMinute: 14.0,
            activityLevel: 'Moderate',
            ecosystemScoreAtTime: 82,
            notes: 'Clear territorial caroling recorded at dawn chorus.',
            peakFrequencyHz: 2800,
          },
          {
            id: 'obs-seed-2',
            speciesId: 'poecile-atricapillus',
            timestamp: new Date(Date.now() - 3600 * 1000 * 36).toISOString(),
            location: 'Cedar Creek Understory',
            latitude: 45.5345,
            longitude: -122.6892,
            confidence: 0.96,
            audioSource: 'sample',
            callsDetected: 18,
            durationSeconds: 60,
            callsPerMinute: 18.0,
            activityLevel: 'High',
            ecosystemScoreAtTime: 85,
            notes: 'Two-tone fee-bee spring contact calls.',
            peakFrequencyHz: 3750,
          },
          {
            id: 'obs-seed-3',
            speciesId: 'cardinalis-cardinalis',
            timestamp: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
            location: 'Oak Savannah Edge',
            latitude: 45.5122,
            longitude: -122.6543,
            confidence: 0.91,
            audioSource: 'sample',
            callsDetected: 12,
            durationSeconds: 60,
            callsPerMinute: 12.0,
            activityLevel: 'Moderate',
            ecosystemScoreAtTime: 80,
            notes: 'High clear liquid whistles paired with metallic chip calls.',
            peakFrequencyHz: 2200,
          },
          {
            id: 'obs-seed-4',
            speciesId: 'bubo-virginianus',
            timestamp: new Date(Date.now() - 3600 * 1000 * 18).toISOString(),
            location: 'High Ridge Old Growth',
            latitude: 45.5411,
            longitude: -122.7012,
            confidence: 0.89,
            audioSource: 'sample',
            callsDetected: 4,
            durationSeconds: 60,
            callsPerMinute: 4.0,
            activityLevel: 'Low',
            ecosystemScoreAtTime: 86,
            notes: 'Nocturnal deep resonant territorial hoots confirming top apex predator presence.',
            peakFrequencyHz: 340,
          },
          {
            id: 'obs-seed-5',
            speciesId: 'setophaga-cerulea',
            timestamp: new Date(Date.now() - 3600 * 1000 * 12).toISOString(),
            location: 'Riparian Forest Reserve',
            latitude: 45.5089,
            longitude: -122.6419,
            confidence: 0.88,
            audioSource: 'sample',
            callsDetected: 16,
            durationSeconds: 60,
            callsPerMinute: 16.0,
            activityLevel: 'High',
            ecosystemScoreAtTime: 88,
            notes: 'Rare high-canopy warble indicating mature contiguous deciduous canopy.',
            peakFrequencyHz: 6800,
          },
          {
            id: 'obs-seed-6',
            speciesId: 'dryocopus-pileatus',
            timestamp: new Date(Date.now() - 3600 * 1000 * 6).toISOString(),
            location: 'North Slope Snag Grove',
            latitude: 45.5312,
            longitude: -122.6681,
            confidence: 0.95,
            audioSource: 'sample',
            callsDetected: 3,
            durationSeconds: 45,
            callsPerMinute: 4.0,
            activityLevel: 'Low',
            ecosystemScoreAtTime: 84,
            notes: 'Powerful resonant wood drumming confirming decaying standing snag habitat.',
            peakFrequencyHz: 1200,
          },
          {
            id: 'obs-seed-7',
            speciesId: 'melospiza-melodia',
            timestamp: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
            location: 'Wetland Buffer Zone',
            latitude: 45.5188,
            longitude: -122.6611,
            confidence: 0.92,
            audioSource: 'sample',
            callsDetected: 10,
            durationSeconds: 60,
            callsPerMinute: 10.0,
            activityLevel: 'Moderate',
            ecosystemScoreAtTime: 81,
            notes: 'Intricate song with staccato opening notes and descending musical trill.',
            peakFrequencyHz: 3200,
          },
        ];

        for (const obs of initialSeeds) {
          this.run(
            `INSERT INTO observations (
              id, speciesId, timestamp, location, latitude, longitude,
              confidence, audioSource, audioFilePath, callsDetected,
              durationSeconds, callsPerMinute, activityLevel,
              ecosystemScoreAtTime, notes, peakFrequencyHz, locationSource, isDemo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              obs.id,
              obs.speciesId,
              obs.timestamp,
              obs.location,
              obs.latitude,
              obs.longitude,
              obs.confidence,
              obs.audioSource,
              null,
              obs.callsDetected,
              obs.durationSeconds,
              obs.callsPerMinute,
              obs.activityLevel,
              obs.ecosystemScoreAtTime,
              obs.notes,
              obs.peakFrequencyHz,
              'station',
              1,
            ]
          );
        }
        console.info('Initial observations seeded successfully.');
      }
    } catch (err) {
      console.error('Error during SQLite database initialization:', err);
    }
  }

  // --- Species queries ---
  async getAllSpecies(): Promise<BirdSpecies[]> {
    await this.ensureReady();
    const rows = this.all<any>('SELECT * FROM species ORDER BY commonName ASC');
    return rows.map((r) => this.rowToSpecies(r));
  }

  async getSpeciesById(id: string): Promise<BirdSpecies | null> {
    await this.ensureReady();
    const row = this.get<any>('SELECT * FROM species WHERE id = ?', [id]);
    if (!row) return null;
    return this.rowToSpecies(row);
  }

  private rowToSpecies(r: any): BirdSpecies {
    return {
      id: r.id,
      commonName: r.commonName,
      scientificName: r.scientificName,
      family: r.family,
      order: r.orderName,
      iucnStatus: r.iucnStatus,
      habitat: r.habitat,
      bioindicatorSensitivity: r.bioindicatorSensitivity,
      sensitivityScore: r.sensitivityScore,
      frequencyRange: [r.minFrequencyHz, r.maxFrequencyHz],
      peakFrequencyHz: r.peakFrequencyHz,
      vocalType: r.vocalType,
      description: r.description || '',
      diet: r.diet || undefined,
      bioindicatorRole: r.bioindicatorRole || undefined,
      distribution: r.distribution || '',
      sampleAudioDesc: r.sampleAudioDesc || '',
      identificationTips: r.identificationTips ? JSON.parse(r.identificationTips) : [],
      threats: r.threats ? JSON.parse(r.threats) : [],
      acousticProfile: r.acousticProfile ? JSON.parse(r.acousticProfile) : ({} as any),
      imageUrl: r.imageUrl || undefined,
    };
  }

  // --- Observation queries ---
  async getObservations(
    filters: {
      startDate?: string;
      endDate?: string;
      speciesId?: string;
      location?: string;
      activityLevel?: string;
      search?: string;
      includeDemo?: boolean;
    } = {}
  ): Promise<Observation[]> {
    await this.ensureReady();
    let query = 'SELECT * FROM observations WHERE 1=1';
    const params: unknown[] = [];

    // Do not return demo/sample data unless explicitly requested via includeDemo
    if (!filters.includeDemo) {
      query += ' AND (isDemo = 0 OR isDemo IS NULL)';
    }

    if (filters.startDate) {
      query += ' AND timestamp >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      query += ' AND timestamp <= ?';
      params.push(filters.endDate);
    }
    if (filters.speciesId && filters.speciesId !== 'all') {
      query += ' AND speciesId = ?';
      params.push(filters.speciesId);
    }
    if (filters.location && filters.location !== 'all') {
      query += ' AND location LIKE ?';
      params.push(`%${filters.location}%`);
    }
    if (filters.activityLevel && filters.activityLevel !== 'all') {
      query += ' AND activityLevel = ?';
      params.push(filters.activityLevel);
    }
    if (filters.search) {
      query += ' AND (notes LIKE ? OR location LIKE ? OR speciesId LIKE ?)';
      const s = `%${filters.search}%`;
      params.push(s, s, s);
    }

    query += ' ORDER BY timestamp DESC';

    const rows = this.all<any>(query, params);
    return rows.map((r) => this.rowToObservation(r));
  }

  async getObservationById(id: string): Promise<Observation | null> {
    await this.ensureReady();
    const r = this.get<any>('SELECT * FROM observations WHERE id = ?', [id]);
    if (!r) return null;
    return this.rowToObservation(r);
  }

  private rowToObservation(r: any): Observation {
    const hasLat = r.latitude !== null && r.latitude !== undefined && !isNaN(Number(r.latitude));
    const hasLng = r.longitude !== null && r.longitude !== undefined && !isNaN(Number(r.longitude));

    return {
      id: r.id,
      speciesId: r.speciesId,
      timestamp: r.timestamp,
      location: r.location || '',
      latitude: hasLat ? Number(r.latitude) : undefined,
      longitude: hasLng ? Number(r.longitude) : undefined,
      locationSource: (r.locationSource as any) || (hasLat && hasLng ? 'manual' : 'unavailable'),
      isDemo: Boolean(r.isDemo),
      confidence: Number(r.confidence),
      notes: r.notes || '',
      source: (r.audioSource === 'manual' ? 'manual' : 'classifier') as 'classifier' | 'manual',
      audioSource: r.audioSource || 'sample',
      audioFilePath: r.audioFilePath || undefined,
      callsDetected: Number(r.callsDetected || 0),
      durationSeconds: Number(r.durationSeconds || 0),
      callsPerMinute:
        r.callsPerMinute !== null && r.callsPerMinute !== undefined
          ? Number(r.callsPerMinute)
          : undefined,
      activityLevel: r.activityLevel || undefined,
      activityUnavailableReason: r.activityUnavailableReason || undefined,
      ecosystemScoreAtTime:
        r.ecosystemScoreAtTime !== null && r.ecosystemScoreAtTime !== undefined
          ? Number(r.ecosystemScoreAtTime)
          : undefined,
      peakFrequencyHz:
        r.peakFrequencyHz !== null && r.peakFrequencyHz !== undefined
          ? Number(r.peakFrequencyHz)
          : undefined,
    };
  }

  async createObservation(obs: Observation): Promise<Observation> {
    await this.ensureReady();

    const hasLat = typeof obs.latitude === 'number' && !isNaN(obs.latitude) && isFinite(obs.latitude);
    const hasLng = typeof obs.longitude === 'number' && !isNaN(obs.longitude) && isFinite(obs.longitude);
    const finalLat = hasLat ? obs.latitude : null;
    const finalLng = hasLng ? obs.longitude : null;
    const finalLocationSource = obs.locationSource || (hasLat && hasLng ? 'manual' : 'unavailable');
    const isDemo = obs.isDemo ? 1 : 0;

    this.run(
      `INSERT INTO observations (
        id, speciesId, timestamp, location, latitude, longitude,
        confidence, audioSource, audioFilePath, callsDetected,
        durationSeconds, callsPerMinute, activityLevel,
        activityUnavailableReason, ecosystemScoreAtTime, notes, peakFrequencyHz,
        locationSource, isDemo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        obs.id,
        obs.speciesId,
        obs.timestamp,
        obs.location || null,
        finalLat,
        finalLng,
        obs.confidence,
        obs.audioSource || obs.source || 'sample',
        obs.audioFilePath || null,
        obs.callsDetected || 0,
        obs.durationSeconds || 0,
        obs.callsPerMinute !== undefined ? obs.callsPerMinute : null,
        obs.activityLevel || null,
        obs.activityUnavailableReason || null,
        obs.ecosystemScoreAtTime !== undefined ? obs.ecosystemScoreAtTime : null,
        obs.notes || '',
        obs.peakFrequencyHz || null,
        finalLocationSource,
        isDemo,
      ]
    );

    const saved = await this.getObservationById(obs.id);
    return saved || obs;
  }

  async deleteObservation(id: string): Promise<boolean> {
    await this.ensureReady();
    const obs = await this.getObservationById(id);
    if (!obs) return false;

    // Delete stored audio file if exists
    if (obs.audioFilePath) {
      const fullPath = path.join(process.cwd(), obs.audioFilePath.replace(/^\//, ''));
      try {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          console.info('Deleted associated audio file:', fullPath);
        }
      } catch (err) {
        console.error('Error deleting audio file:', err);
      }
    }

    const res = this.run('DELETE FROM observations WHERE id = ?', [id]);
    return (res.changes || 0) > 0;
  }

  async createPrediction(pred: Omit<PredictionRecord, 'id'> & { id?: string }): Promise<PredictionRecord> {
    await this.ensureReady();
    const id = pred.id || `pred-${Date.now()}-${Math.round(Math.random() * 1e5)}`;
    const record: PredictionRecord = {
      id,
      observationId: pred.observationId,
      recordingId: pred.recordingId,
      predictedSpeciesId: pred.predictedSpeciesId,
      topCandidates: pred.topCandidates,
      confidence: pred.confidence,
      modelVersion: pred.modelVersion,
      classificationMethod: pred.classificationMethod,
      timestamp: pred.timestamp || new Date().toISOString(),
      inferenceStatus: pred.inferenceStatus,
      userConfirmedSpeciesId: pred.userConfirmedSpeciesId,
      notes: pred.notes,
    };

    this.run(
      `INSERT INTO predictions (
        id, observationId, recordingId, predictedSpeciesId,
        topCandidates, confidence, modelVersion, classificationMethod,
        timestamp, inferenceStatus, userConfirmedSpeciesId, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.observationId || null,
        record.recordingId || null,
        record.predictedSpeciesId,
        JSON.stringify(record.topCandidates || []),
        record.confidence,
        record.modelVersion,
        record.classificationMethod,
        record.timestamp,
        record.inferenceStatus,
        record.userConfirmedSpeciesId || null,
        record.notes || null,
      ]
    );

    return record;
  }

  async getPredictions(limit = 50): Promise<PredictionRecord[]> {
    await this.ensureReady();
    const rows = this.all<any>(
      'SELECT * FROM predictions ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );
    return rows.map((r) => ({
      id: r.id,
      observationId: r.observationId || undefined,
      recordingId: r.recordingId || undefined,
      predictedSpeciesId: r.predictedSpeciesId,
      topCandidates: typeof r.topCandidates === 'string' ? JSON.parse(r.topCandidates) : r.topCandidates,
      confidence: r.confidence,
      modelVersion: r.modelVersion,
      classificationMethod: r.classificationMethod,
      timestamp: r.timestamp,
      inferenceStatus: r.inferenceStatus,
      userConfirmedSpeciesId: r.userConfirmedSpeciesId || undefined,
      notes: r.notes || undefined,
    }));
  }

  async confirmPredictionSpecies(id: string, speciesId: string): Promise<boolean> {
    await this.ensureReady();
    const res = this.run(
      'UPDATE predictions SET userConfirmedSpeciesId = ? WHERE id = ?',
      [speciesId, id]
    );
    return (res.changes || 0) > 0;
  }
}

export const dbService = new DatabaseService();
