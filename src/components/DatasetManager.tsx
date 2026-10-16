import React, { useState, useEffect } from 'react';
import {
  Database,
  Cpu,
  Layers,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Download,
  RefreshCw,
  Info,
  ShieldCheck,
  BarChart2,
  Activity,
  FolderOpen,
  History,
  Table,
  Check,
  ExternalLink,
} from 'lucide-react';
import { DatasetStats, PredictionRecord } from '../types';

export const DatasetManager: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dataset' | 'evaluation' | 'predictions'>('dataset');
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [modelStatus, setModelStatus] = useState<any>(null);
  const [evaluation, setEvaluation] = useState<any>(null);
  const [predictions, setPredictions] = useState<PredictionRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const fetchDatasetInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, mlRes, evalRes, predRes] = await Promise.all([
        fetch('/api/dataset/stats'),
        fetch('/api/ml/status'),
        fetch('/api/evaluation/latest'),
        fetch('/api/predictions?limit=50'),
      ]);

      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
      if (mlRes.ok) {
        setModelStatus(await mlRes.json());
      }
      if (evalRes.ok) {
        const evalData = await evalRes.json();
        if (evalData.available) {
          setEvaluation(evalData.report);
        }
      }
      if (predRes.ok) {
        setPredictions(await predRes.json());
      }
    } catch (err: any) {
      console.error('Error fetching dataset information:', err);
      setError('Unable to load dataset statistics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDatasetInfo();
  }, []);

  const handleConfirmSpecies = async (predictionId: string, speciesId: string) => {
    setConfirmingId(predictionId);
    try {
      const res = await fetch(`/api/predictions/${predictionId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speciesId }),
      });
      if (res.ok) {
        setPredictions((prev) =>
          prev.map((p) =>
            p.id === predictionId ? { ...p, userConfirmedSpeciesId: speciesId } : p
          )
        );
      }
    } catch (e) {
      console.error('Failed to confirm species:', e);
    } finally {
      setConfirmingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <Database className="w-5 h-5" />
            </span>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Dataset Management & Machine Learning Pipeline
            </h2>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30">
              Verified CC Bioacoustics
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Inspect genuine labelled avian recordings, stratified train/validation/test splits, Creative Commons licensing provenance, and reproducible CPU-trained PyTorch CNN checkpoints.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/api/dataset/manifest"
            download="birdsong_manifest.csv"
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition self-start md:self-auto cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Download CSV Manifest</span>
          </a>

          <button
            onClick={fetchDatasetInfo}
            disabled={loading}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition self-start md:self-auto cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-4 shadow-lg">
          <span className="text-xs text-slate-400 font-medium block">Total Valid Recordings</span>
          <strong className="text-2xl font-bold font-mono text-white mt-1 block">
            {stats ? stats.validRecordings : '—'}
          </strong>
          <span className="text-[10px] text-emerald-400 font-mono mt-1 block">
            {stats ? `${stats.totalDurationSeconds}s (${stats.totalDurationHours} hrs)` : 'Loading'}
          </span>
        </div>

        <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-4 shadow-lg">
          <span className="text-xs text-slate-400 font-medium block">Training Split</span>
          <strong className="text-2xl font-bold font-mono text-emerald-300 mt-1 block">
            {stats ? stats.splitCounts.train : '—'}
          </strong>
          <span className="text-[10px] text-slate-400 mt-1 block">Isolated recordings</span>
        </div>

        <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-4 shadow-lg">
          <span className="text-xs text-slate-400 font-medium block">Validation Split</span>
          <strong className="text-2xl font-bold font-mono text-amber-300 mt-1 block">
            {stats ? stats.splitCounts.val : '—'}
          </strong>
          <span className="text-[10px] text-slate-400 mt-1 block">Checkpoint selection</span>
        </div>

        <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-4 shadow-lg">
          <span className="text-xs text-slate-400 font-medium block">Held-Out Test Split</span>
          <strong className="text-2xl font-bold font-mono text-sky-300 mt-1 block">
            {stats ? stats.splitCounts.test : '—'}
          </strong>
          <span className="text-[10px] text-sky-400 font-mono mt-1 block">Strictly isolated</span>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-emerald-500/20 pb-2">
        <button
          onClick={() => setActiveTab('dataset')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'dataset'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-900'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Dataset & Splits</span>
        </button>

        <button
          onClick={() => setActiveTab('evaluation')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'evaluation'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-900'
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          <span>CNN Model & Evaluation Report</span>
        </button>

        <button
          onClick={() => setActiveTab('predictions')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'predictions'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-900'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Prediction Audit Log</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-800 text-emerald-300">
            {predictions.length}
          </span>
        </button>
      </div>

      {/* Tab 1: Dataset & Splits */}
      {activeTab === 'dataset' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Species Distribution (6 cols) */}
          <div className="lg:col-span-6 bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-emerald-500/20">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-emerald-400" />
                <span>Labelled Recordings by Species</span>
              </h3>
              <span className="text-[10px] font-mono text-slate-400">
                {stats ? Object.keys(stats.speciesCounts).length : 0} species classes
              </span>
            </div>

            {stats && Object.keys(stats.speciesCounts).length > 0 ? (
              <div className="space-y-2.5">
                {Object.entries(stats.speciesCounts).map(([speciesName, count]) => {
                  const pct = Math.round((count / (stats.validRecordings || 1)) * 100);
                  return (
                    <div key={speciesName} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-200 font-medium">{speciesName}</span>
                        <span className="font-mono text-emerald-300 text-[11px]">
                          {count} recordings ({pct}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-emerald-500/15">
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-slate-400">
                No recordings cataloged in manifest yet.
              </div>
            )}

            {/* Source Attribution & License Info */}
            <div className="pt-4 border-t border-emerald-500/15 space-y-2">
              <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Provenance & Licensing Standards</span>
              </h4>
              <div className="bg-slate-950/70 p-3 rounded-xl border border-emerald-500/15 text-xs text-slate-400 space-y-1.5">
                <p>
                  • <strong>Source Archives</strong>: Open Creative Commons bioacoustics repositories (Wikimedia Commons & Xeno-canto open collections).
                </p>
                <p>
                  • <strong>Licensing</strong>: All real audio clips carry verified CC licenses (CC BY-SA 3.0, CC BY-SA 4.0, or Public Domain) with recordist attribution.
                </p>
                <p>
                  • <strong>Leakage Prevention</strong>: Audio clips originating from the same recording session share a common <code className="text-emerald-300 font-mono text-[11px]">source_recording_id</code> and are guaranteed to reside in the exact same split.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Custom CNN Model & Dataset Import Instructions (6 cols) */}
          <div className="lg:col-span-6 space-y-6">
            {/* Model Status Card */}
            <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-5 shadow-lg space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-emerald-500/20">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white">Custom PyTorch CNN Status</h3>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    modelStatus?.status === 'healthy'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}
                >
                  {modelStatus?.status === 'healthy' ? 'ACTIVE & LOADED' : 'OFFLINE'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-950/70 p-2.5 rounded-xl border border-emerald-500/10">
                  <span className="text-[10px] text-slate-400 block">Model Version</span>
                  <strong className="text-white font-mono">{modelStatus?.model_version || 'cnn-v1.0.0-cpu'}</strong>
                </div>
                <div className="bg-slate-950/70 p-2.5 rounded-xl border border-emerald-500/10">
                  <span className="text-[10px] text-slate-400 block">Architecture</span>
                  <strong className="text-emerald-300 font-mono text-[11px] truncate block">
                    {modelStatus?.architecture || 'BioacousticCNN-4Block'}
                  </strong>
                </div>
                <div className="bg-slate-950/70 p-2.5 rounded-xl border border-emerald-500/10">
                  <span className="text-[10px] text-slate-400 block">Classes Trained</span>
                  <strong className="text-white font-mono">{modelStatus?.num_classes || 5} species</strong>
                </div>
                <div className="bg-slate-950/70 p-2.5 rounded-xl border border-emerald-500/10">
                  <span className="text-[10px] text-slate-400 block">Execution Hardware</span>
                  <strong className="text-sky-300 font-mono">CPU Optimized</strong>
                </div>
              </div>
            </div>

            {/* Dataset Import & CLI Instructions */}
            <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-5 shadow-lg space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-emerald-400" />
                <span>Importing Additional Recordings & Reproducibility</span>
              </h3>
              <p className="text-xs text-slate-300">
                You can import local WAV, MP3, or FLAC recordings or download additional species from open archives using the included Python CLI:
              </p>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-[11px] text-emerald-300 space-y-1">
                <div># 1. Download more species from open archives:</div>
                <div className="text-slate-300">/ml_env/bin/python3 ml/dataset/download_samples.py --limit 5</div>
                <div className="mt-1"># 2. Re-split dataset reproducibly (grouped by session):</div>
                <div className="text-slate-300">/ml_env/bin/python3 ml/dataset/split.py</div>
                <div className="mt-1"># 3. Retrain custom CNN model on CPU:</div>
                <div className="text-slate-300">/ml_env/bin/python3 ml/training/train.py --epochs 15</div>
                <div className="mt-1"># 4. Evaluate held-out test metrics:</div>
                <div className="text-slate-300">/ml_env/bin/python3 ml/evaluation/evaluate.py</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: CNN Model & Evaluation Report */}
      {activeTab === 'evaluation' && (
        <div className="space-y-6">
          {evaluation ? (
            <div className="space-y-6">
              {/* Overall Metrics Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-4 shadow-lg text-center">
                  <span className="text-xs text-slate-400 block">Overall Test Accuracy</span>
                  <strong className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                    {(evaluation.overall_metrics.accuracy * 100).toFixed(1)}%
                  </strong>
                  <span className="text-[10px] text-slate-400">Strictly held-out split</span>
                </div>

                <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-4 shadow-lg text-center">
                  <span className="text-xs text-slate-400 block">Macro F1 Score</span>
                  <strong className="text-2xl font-bold font-mono text-amber-300 mt-1 block">
                    {evaluation.overall_metrics.macro_f1.toFixed(3)}
                  </strong>
                  <span className="text-[10px] text-slate-400">Unweighted class mean</span>
                </div>

                <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-4 shadow-lg text-center">
                  <span className="text-xs text-slate-400 block">Macro Recall</span>
                  <strong className="text-2xl font-bold font-mono text-sky-300 mt-1 block">
                    {(evaluation.overall_metrics.macro_recall * 100).toFixed(1)}%
                  </strong>
                  <span className="text-[10px] text-slate-400">Sensitivity across classes</span>
                </div>

                <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-4 shadow-lg text-center">
                  <span className="text-xs text-slate-400 block">Uncertainty Threshold</span>
                  <strong className="text-2xl font-bold font-mono text-purple-300 mt-1 block">
                    {((evaluation.uncertainty_threshold || 0.35) * 100).toFixed(0)}%
                  </strong>
                  <span className="text-[10px] text-slate-400">Flags low-confidence calls</span>
                </div>
              </div>

              {/* Confusion Matrix & Per-Species Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Confusion Matrix (6 cols) */}
                <div className="lg:col-span-6 bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-5 shadow-lg space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-emerald-500/20">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Table className="w-4 h-4 text-emerald-400" />
                      <span>Held-Out Confusion Matrix</span>
                    </h3>
                    <span className="text-[10px] font-mono text-slate-400">Rows: Actual • Cols: Predicted</span>
                  </div>

                  {evaluation.confusion_matrix && evaluation.class_labels ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800 text-[10px] text-slate-400 font-mono">
                            <th className="p-1.5">Actual \ Pred</th>
                            {evaluation.class_labels.map((lbl: string) => (
                              <th key={lbl} className="p-1.5 text-center truncate max-w-[70px]" title={lbl}>
                                {lbl.split('-')[0]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {evaluation.confusion_matrix.map((row: number[], rIdx: number) => {
                            const actualLabel = evaluation.class_labels[rIdx];
                            return (
                              <tr key={actualLabel} className="border-b border-slate-900 hover:bg-slate-950/40">
                                <td className="p-1.5 font-mono text-[11px] text-slate-300 truncate max-w-[90px]" title={actualLabel}>
                                  {actualLabel.split('-')[0]}
                                </td>
                                {row.map((val: number, cIdx: number) => {
                                  const isDiagonal = rIdx === cIdx;
                                  const isCorrect = isDiagonal && val > 0;
                                  const isConfused = !isDiagonal && val > 0;
                                  return (
                                    <td
                                      key={cIdx}
                                      className={`p-1.5 text-center font-mono text-[11px] font-bold ${
                                        isCorrect
                                          ? 'bg-emerald-500/20 text-emerald-300'
                                          : isConfused
                                          ? 'bg-amber-500/20 text-amber-300'
                                          : 'text-slate-600'
                                      }`}
                                    >
                                      {val}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  {evaluation.common_confusion_pairs && evaluation.common_confusion_pairs.length > 0 && (
                    <div className="pt-2 border-t border-slate-800 space-y-1">
                      <span className="text-[10px] uppercase font-mono text-slate-400 block">Acoustic Confusion Insights:</span>
                      {evaluation.common_confusion_pairs.map((p: any, idx: number) => (
                        <div key={idx} className="text-[11px] text-slate-300 flex items-center justify-between">
                          <span>
                            Actual <strong className="text-amber-300 font-mono">{p.actual}</strong> classified as <strong className="text-slate-200 font-mono">{p.predicted}</strong>
                          </span>
                          <span className="text-slate-400 font-mono">{p.count}×</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Per-Species Breakdown (6 cols) */}
                <div className="lg:col-span-6 bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-5 shadow-lg space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-emerald-500/20">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <BarChart2 className="w-4 h-4 text-emerald-400" />
                      <span>Per-Class Classification Metrics</span>
                    </h3>
                    <span className="text-[10px] font-mono text-slate-400">Class Evaluation</span>
                  </div>

                  {evaluation.per_species ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800 text-[10px] text-slate-400 font-mono">
                            <th className="p-1.5">Species</th>
                            <th className="p-1.5 text-right">Precision</th>
                            <th className="p-1.5 text-right">Recall</th>
                            <th className="p-1.5 text-right">F1 Score</th>
                            <th className="p-1.5 text-right">Support</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(evaluation.per_species).map(([spId, m]: [string, any]) => (
                            <tr key={spId} className="border-b border-slate-900 hover:bg-slate-950/40">
                              <td className="p-1.5">
                                <div className="font-semibold text-slate-200">{m.common_name}</div>
                                <div className="text-[10px] italic text-slate-400">{m.scientific_name}</div>
                              </td>
                              <td className="p-1.5 text-right font-mono text-slate-300">
                                {(m.precision * 100).toFixed(0)}%
                              </td>
                              <td className="p-1.5 text-right font-mono text-slate-300">
                                {(m.recall * 100).toFixed(0)}%
                              </td>
                              <td className="p-1.5 text-right font-mono font-bold text-emerald-400">
                                {m.f1_score.toFixed(2)}
                              </td>
                              <td className="p-1.5 text-right font-mono text-slate-400">
                                {m.support}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
                    <div className="text-emerald-300 font-semibold">Evaluation Methodology:</div>
                    <p>
                      Evaluation was strictly executed on held-out test audio samples that were excluded from both model training and validation hyperparameter tuning. No data leakage occurred between recording sessions.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-12 text-center text-slate-400 space-y-2">
              <Cpu className="w-8 h-8 text-slate-600 mx-auto" />
              <h4 className="text-white font-bold">No Evaluation Report Found</h4>
              <p className="text-xs text-slate-400">
                Run <code className="text-emerald-300">/ml_env/bin/python3 ml/evaluation/evaluate.py</code> to generate a held-out test report.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Prediction Audit Log */}
      {activeTab === 'predictions' && (
        <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-emerald-500/20">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-400" />
                <span>SQLite Prediction History & Inferences</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Every audio classification event is audited with its model activations, confidence, latency, and status.
              </p>
            </div>
            <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
              {predictions.length} recorded events
            </span>
          </div>

          {predictions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] text-slate-400 font-mono">
                    <th className="p-2">Timestamp</th>
                    <th className="p-2">Predicted Species</th>
                    <th className="p-2">Method</th>
                    <th className="p-2">Score</th>
                    <th className="p-2">Inference Status</th>
                    <th className="p-2">Top Activations</th>
                    <th className="p-2 text-right">Human Confirmation</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.map((p) => {
                    const topCand = p.topCandidates?.[0];
                    return (
                      <tr key={p.id} className="border-b border-slate-900 hover:bg-slate-950/40">
                        <td className="p-2 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                          {new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td className="p-2">
                          <strong className="text-slate-200">
                            {topCand?.common_name || p.predictedSpeciesId}
                          </strong>
                          {topCand?.scientific_name && (
                            <div className="text-[10px] italic text-slate-400">
                              {topCand.scientific_name}
                            </div>
                          )}
                        </td>
                        <td className="p-2 font-mono text-[11px] text-emerald-400 uppercase">
                          {p.classificationMethod}
                        </td>
                        <td className="p-2 font-mono text-[11px] text-slate-200">
                          {(p.confidence * 100).toFixed(1)}%
                        </td>
                        <td className="p-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                              p.inferenceStatus === 'success'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {p.inferenceStatus}
                          </span>
                        </td>
                        <td className="p-2 font-mono text-[10px] text-slate-400">
                          {p.topCandidates?.slice(0, 2).map((c) => (
                            <span key={c.species_id} className="mr-2">
                              {c.common_name.split(' ')[0]}: {(c.model_score * 100).toFixed(0)}%
                            </span>
                          ))}
                        </td>
                        <td className="p-2 text-right">
                          {p.userConfirmedSpeciesId ? (
                            <span className="text-[11px] text-emerald-400 font-semibold flex items-center justify-end gap-1">
                              <Check className="w-3 h-3" />
                              <span>Verified</span>
                            </span>
                          ) : (
                            <button
                              onClick={() => handleConfirmSpecies(p.id, p.predictedSpeciesId)}
                              disabled={confirmingId === p.id}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded text-[11px] transition cursor-pointer"
                            >
                              Confirm
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center text-xs text-slate-400">
              No predictions recorded yet. Run a classification in the Bioacoustic Classifier to log predictions.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
