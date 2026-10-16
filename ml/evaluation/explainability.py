import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Optional

class GradCAMBioacoustics:
    """
    Grad-CAM implementation for Bioacoustic CNN on log Mel-spectrograms.
    Identifies which time-frequency bins most heavily influenced the classification decision.
    """
    def __init__(self, model: nn.Module, target_layer: Optional[nn.Module] = None):
        self.model = model
        self.target_layer = target_layer or model.get_last_conv_layer()

        self.gradients: Optional[torch.Tensor] = None
        self.activations: Optional[torch.Tensor] = None

        self.target_layer.register_forward_hook(self._forward_hook)
        self.target_layer.register_full_backward_hook(self._backward_hook)

    def _forward_hook(self, module, input, output):
        self.activations = output.detach()

    def _backward_hook(self, module, grad_input, grad_output):
        self.gradients = grad_output[0].detach()

    def generate_saliency(self, input_tensor: torch.Tensor, target_class_idx: int) -> np.ndarray:
        """
        input_tensor: (1, 1, H, W)
        Returns: (H, W) float32 normalized saliency heatmap in [0, 1]
        """
        self.model.eval()
        self.model.zero_grad()

        input_tensor.requires_grad_(True)
        logits = self.model(input_tensor)

        score = logits[0, target_class_idx]
        score.backward()

        if self.gradients is None or self.activations is None:
            return np.zeros((input_tensor.shape[2], input_tensor.shape[3]), dtype=np.float32)

        # Global average pool the gradients across spatial dimensions
        weights = torch.mean(self.gradients, dim=(2, 3), keepdim=True) # (1, C, 1, 1)

        # Weighted combination of activation maps
        cam = torch.sum(weights * self.activations, dim=1, keepdim=True) # (1, 1, H_conv, W_conv)
        cam = F.relu(cam) # ReLU to keep only positive contributions

        # Upsample back to input size
        cam_upsampled = F.interpolate(
            cam,
            size=(input_tensor.shape[2], input_tensor.shape[3]),
            mode='bilinear',
            align_corners=False
        )

        heatmap = cam_upsampled.squeeze().cpu().numpy()
        h_min, h_max = heatmap.min(), heatmap.max()
        if h_max > h_min:
            heatmap = (heatmap - h_min) / (h_max - h_min)
        else:
            heatmap = np.zeros_like(heatmap)

        return heatmap.astype(np.float32)
