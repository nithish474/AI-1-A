import os
import io
import wave
import subprocess
import numpy as np
import torch
from typing import Tuple, List, Optional

SAMPLE_RATE = 16000
TARGET_DURATION = 3.0  # seconds
TARGET_SAMPLES = int(SAMPLE_RATE * TARGET_DURATION)  # 48,000 samples
HOP_DURATION = 1.5  # seconds
HOP_SAMPLES = int(SAMPLE_RATE * HOP_DURATION)  # 24,000 samples
RMS_SILENCE_THRESHOLD = 0.002

N_FFT = 1024
HOP_LENGTH = 375
N_MELS = 64
F_MIN = 150.0
F_MAX = 11000.0

def hz_to_mel(f: np.ndarray) -> np.ndarray:
    return 2595.0 * np.log10(1.0 + f / 700.0)

def mel_to_hz(m: np.ndarray) -> np.ndarray:
    return 700.0 * (10.0 ** (m / 2595.0) - 1.0)

def create_mel_filterbank(sr: int = SAMPLE_RATE, n_fft: int = N_FFT, n_mels: int = N_MELS, f_min: float = F_MIN, f_max: float = F_MAX) -> np.ndarray:
    n_freqs = n_fft // 2 + 1
    mel_min = hz_to_mel(f_min)
    mel_max = hz_to_mel(f_max)
    mel_points = np.linspace(mel_min, mel_max, n_mels + 2)
    hz_points = mel_to_hz(mel_points)
    bin_points = np.floor((n_fft + 1) * hz_points / sr).astype(int)
    bin_points = np.clip(bin_points, 0, n_freqs - 1)

    weights = np.zeros((n_mels, n_freqs), dtype=np.float32)
    for i in range(1, n_mels + 1):
        left = bin_points[i - 1]
        center = bin_points[i]
        right = bin_points[i + 1]

        if center > left:
            weights[i - 1, left:center] = (np.arange(left, center) - left) / (center - left)
        if right > center:
            weights[i - 1, center:right] = (right - np.arange(center, right)) / (right - center)

    # Area normalization
    enorm = 2.0 / (hz_points[2:n_mels + 2] - hz_points[:n_mels])
    weights *= enorm[:, np.newaxis]
    return weights

MEL_FBANK = create_mel_filterbank()

def decode_audio_with_ffmpeg(input_data: bytes, target_sr: int = SAMPLE_RATE) -> Tuple[np.ndarray, int]:
    """Decodes any audio container (WAV, MP3, OGG, FLAC) to raw float32 mono PCM via ffmpeg pipe."""
    cmd = [
        'ffmpeg', '-y',
        '-i', 'pipe:0',
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-ac', '1',
        '-ar', str(target_sr),
        'pipe:1'
    ]
    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        out, _ = proc.communicate(input=input_data)
        if len(out) == 0:
            raise ValueError("FFmpeg output is empty")
        pcm16 = np.frombuffer(out, dtype=np.int16)
        samples = pcm16.astype(np.float32) / 32768.0
        return samples, target_sr
    except Exception as e:
        # Fallback to standard wave module if ffmpeg fails
        try:
            with wave.open(io.BytesIO(input_data), 'rb') as wf:
                n_channels = wf.getnchannels()
                sampwidth = wf.getsampwidth()
                sr = wf.getframerate()
                frames = wf.readframes(wf.getnframes())
                if sampwidth == 2:
                    raw = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
                elif sampwidth == 1:
                    raw = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
                else:
                    raw = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
                if n_channels > 1:
                    raw = raw.reshape(-1, n_channels).mean(axis=1)
                return raw, sr
        except Exception:
            raise RuntimeError(f"Unable to decode audio: {e}")

def load_audio_mono(file_path: str, target_sr: int = SAMPLE_RATE) -> Tuple[np.ndarray, int]:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")
    with open(file_path, 'rb') as f:
        data = f.read()
    return decode_audio_with_ffmpeg(data, target_sr)

def pad_or_crop_audio(samples: np.ndarray, target_length: int = TARGET_SAMPLES, offset_ratio: float = 0.5) -> np.ndarray:
    """Pads with zeros or crops audio to target_length based on offset_ratio in [0, 1]."""
    n = len(samples)
    if n == target_length:
        return samples.copy()
    elif n > target_length:
        max_start = n - target_length
        start = int(np.clip(offset_ratio, 0.0, 1.0) * max_start)
        return samples[start:start + target_length].copy()
    else:
        padded = np.zeros(target_length, dtype=np.float32)
        padded[:n] = samples
        return padded

def slice_audio_windows(
    audio: np.ndarray,
    sr: int = SAMPLE_RATE,
    window_samples: int = TARGET_SAMPLES,
    hop_samples: int = HOP_SAMPLES,
    rms_threshold: float = RMS_SILENCE_THRESHOLD
) -> List[Tuple[np.ndarray, int, float]]:
    """
    Slices audio into overlapping window_samples (e.g. 3.0s) with step hop_samples (e.g. 1.5s).
    Filters out near-silent windows where RMS < rms_threshold.
    Returns list of (window_samples, start_sample, rms_value).
    Guarantees at least 1 window is returned if audio contains any signal (highest RMS fallback).
    """
    n = len(audio)
    if n == 0:
        return []

    windows = []
    all_candidates = []

    if n <= window_samples:
        padded = np.zeros(window_samples, dtype=np.float32)
        padded[:n] = audio
        rms = float(np.sqrt(np.mean(padded ** 2)))
        windows.append((padded, 0, rms))
        return windows

    for start in range(0, n - window_samples + 1, hop_samples):
        chunk = audio[start:start + window_samples]
        rms = float(np.sqrt(np.mean(chunk ** 2)))
        all_candidates.append((chunk, start, rms))
        if rms >= rms_threshold:
            windows.append((chunk, start, rms))

    # Also add the tail window if significant remaining audio
    last_start = n - window_samples
    if last_start > 0 and (len(all_candidates) == 0 or all_candidates[-1][1] < last_start):
        chunk = audio[last_start:n]
        rms = float(np.sqrt(np.mean(chunk ** 2)))
        all_candidates.append((chunk, last_start, rms))
        if rms >= rms_threshold:
            windows.append((chunk, last_start, rms))

    # If all windows fell below threshold (e.g. quiet nocturnal recording), retain highest energy window
    if len(windows) == 0 and len(all_candidates) > 0:
        best_cand = max(all_candidates, key=lambda c: c[2])
        windows.append(best_cand)

    return windows

def compute_mel_spectrogram(
    samples: np.ndarray,
    sr: int = SAMPLE_RATE,
    n_fft: int = N_FFT,
    hop_length: int = HOP_LENGTH,
    n_mels: int = N_MELS,
    target_frames: int = 128
) -> np.ndarray:
    """Computes normalized log Mel-spectrogram of shape (N_MELS, target_frames)."""
    # Short-time Fourier Transform (STFT)
    window = np.hanning(n_fft)
    n_frames = max(1, (len(samples) - n_fft) // hop_length + 1)
    stft = np.zeros((n_fft // 2 + 1, n_frames), dtype=np.float32)

    for i in range(n_frames):
        start = i * hop_length
        frame = samples[start:start + n_fft]
        if len(frame) < n_fft:
            frame = np.pad(frame, (0, n_fft - len(frame)))
        windowed = frame * window
        fft_res = np.fft.rfft(windowed, n=n_fft)
        stft[:, i] = np.abs(fft_res) ** 2

    # Mel-filterbank application
    fbank = MEL_FBANK if (sr == SAMPLE_RATE and n_mels == N_MELS) else create_mel_filterbank(sr, n_fft, n_mels)
    mel_spec = np.dot(fbank, stft)

    # Log scaling
    log_mel = np.log10(np.maximum(mel_spec, 1e-6))

    # Min-max normalize to [0, 1]
    m_min = log_mel.min()
    m_max = log_mel.max()
    if m_max > m_min:
        norm_mel = (log_mel - m_min) / (m_max - m_min)
    else:
        norm_mel = np.zeros_like(log_mel)

    # Adjust temporal dimension to exactly target_frames (128)
    if norm_mel.shape[1] > target_frames:
        norm_mel = norm_mel[:, :target_frames]
    elif norm_mel.shape[1] < target_frames:
        pad_width = target_frames - norm_mel.shape[1]
        norm_mel = np.pad(norm_mel, ((0, 0), (0, pad_width)), mode='edge')

    return norm_mel.astype(np.float32)

def augment_audio(samples: np.ndarray) -> np.ndarray:
    """Audio-domain augmentations: random gain and light additive Gaussian noise."""
    aug = samples.copy()
    # Random gain between 0.8x and 1.2x
    gain = np.random.uniform(0.8, 1.2)
    aug = aug * gain

    # Additive noise with 50% probability
    if np.random.rand() > 0.5:
        noise_level = np.random.uniform(0.001, 0.004)
        noise = np.random.normal(0.0, noise_level, size=aug.shape).astype(np.float32)
        aug = aug + noise

    # Clip to valid audio range [-1.0, 1.0]
    return np.clip(aug, -1.0, 1.0).astype(np.float32)

def apply_spec_augment(
    mel: np.ndarray,
    max_freq_mask: int = 8,
    max_time_mask: int = 16,
    num_freq_masks: int = 1,
    num_time_masks: int = 1
) -> np.ndarray:
    """
    SpecAugment (Park et al. 2019): applies time and frequency channel masking to Mel-spectrogram.
    Input: (n_mels, time_frames) or (1, n_mels, time_frames)
    """
    aug = mel.copy()
    is_3d = (aug.ndim == 3)
    data = aug[0] if is_3d else aug
    n_mels, n_frames = data.shape
    mean_val = float(np.mean(data))

    # Frequency masking
    for _ in range(num_freq_masks):
        f_width = np.random.randint(1, max(2, max_freq_mask + 1))
        f_start = np.random.randint(0, max(1, n_mels - f_width))
        data[f_start:f_start + f_width, :] = mean_val

    # Time masking
    for _ in range(num_time_masks):
        t_width = np.random.randint(1, max(2, max_time_mask + 1))
        t_start = np.random.randint(0, max(1, n_frames - t_width))
        data[:, t_start:t_start + t_width] = mean_val

    if is_3d:
        aug[0] = data
    return aug.astype(np.float32)

def extract_features_for_inference(audio_bytes: bytes, sr: int = SAMPLE_RATE) -> torch.Tensor:
    """End-to-end tensor preprocessing for inference input (1, 1, 64, 128)."""
    samples, _ = decode_audio_with_ffmpeg(audio_bytes, target_sr=sr)
    samples = pad_or_crop_audio(samples, target_length=TARGET_SAMPLES)
    mel = compute_mel_spectrogram(samples, sr=sr, target_frames=128)
    # Return as (1, 1, 64, 128) torch tensor
    return torch.from_numpy(mel).unsqueeze(0).unsqueeze(0).float()
