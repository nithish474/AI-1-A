import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Dict, Any, Optional

class ConvBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int):
        super().__init__()
        self.conv = nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1, bias=False)
        self.bn = nn.BatchNorm2d(out_channels)
        self.relu = nn.ReLU(inplace=True)
        self.pool = nn.MaxPool2d(kernel_size=2, stride=2)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.pool(self.relu(self.bn(self.conv(x))))

class BioacousticCNN(nn.Module):
    """
    Lightweight, CPU-optimized 4-block Bioacoustic CNN designed for avian
    Mel-spectrogram classification.
    Inputs: (Batch, 1, N_MELS=64, TIME_STEPS=128)
    Outputs: Class logits
    """
    def __init__(self, num_classes: int = 5, in_channels: int = 1):
        super().__init__()
        self.num_classes = num_classes
        self.in_channels = in_channels

        self.block1 = ConvBlock(in_channels, 32)
        self.block2 = ConvBlock(32, 64)
        self.block3 = ConvBlock(64, 128)
        self.block4 = nn.Sequential(
            nn.Conv2d(128, 256, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(256),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d((2, 2))
        )

        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(0.4),
            nn.Linear(256 * 2 * 2, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(0.2),
            nn.Linear(128, num_classes)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Expected input shape: (B, 1, 64, 128)
        x = self.block1(x)
        x = self.block2(x)
        x = self.block3(x)
        x = self.block4(x)
        logits = self.classifier(x)
        return logits

    def get_last_conv_layer(self) -> nn.Module:
        return self.block4[0]
