import os
import io
import wave
import subprocess
import tempfile
import numpy as np
import torch
from typing import Tuple, Optional

SAMPLE_RATE = 16000
TARGET_DURATION = 3.0  # seconds
TARGET_SAMPLES = int(SAMPLE_RATE * TARGET_DURATION)  # 48,000 samples
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

def pad_or_crop_audio(samples: np.ndarray, target_length: int = TARGET_SAMPLES) -> np.ndarray:
    n = len(samples)
    if n == target_length:
        return samples
    elif n > target_length:
        # Take center or start crop
        start = max(0, (n - target_length) // 2)
        return samples[start:start + target_length]
    else:
        # Pad with zeros
        padded = np.zeros(target_length, dtype=np.float32)
        padded[:n] = samples
        return padded

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

def extract_features_for_inference(audio_bytes: bytes, sr: int = SAMPLE_RATE) -> torch.Tensor:
    """End-to-end tensor preprocessing for inference input (1, 1, 64, 128)."""
    samples, _ = decode_audio_with_ffmpeg(audio_bytes, target_sr=sr)
    samples = pad_or_crop_audio(samples, target_length=TARGET_SAMPLES)
    mel = compute_mel_spectrogram(samples, sr=sr, target_frames=128)
    # Return as (1, 1, 64, 128) torch tensor
    return torch.from_numpy(mel).unsqueeze(0).unsqueeze(0).float()
