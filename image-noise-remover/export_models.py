"""Export the desktop checkpoints for browser inference."""
import argparse
from pathlib import Path
import sys

import torch
from torch import nn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from jpeg_model import load_jpeg_model  # noqa: E402
from third_party.fbcnn.network_fbcnn import FBCNN  # noqa: E402


def dynamic_positions(height, width, dim, device, dtype, reference_size):
    # The legacy ONNX exporter specializes torch.linspace's sample count.
    y = torch.arange(height, device=device, dtype=torch.float32)
    x = torch.arange(width, device=device, dtype=torch.float32)
    y = y * (reference_size - 1) / (height - 1 + (height == 1))
    x = x * (reference_size - 1) / (width - 1 + (width == 1))
    omega = 1 / (10000 ** (torch.arange(dim // 4, device=device) / (dim // 4)))
    y, x = torch.meshgrid(y, x, indexing="ij")
    y, x = y.reshape(-1, 1) * omega, x.reshape(-1, 1) * omega
    return torch.cat((x.sin(), x.cos(), y.sin(), y.cos()), dim=1)[None].to(dtype)


def decode_haar(coefficients):
    # Interleave rows and columns without in-place strided assignment.
    low, vertical, horizontal, diagonal = coefficients.chunk(4, dim=1)
    top = torch.stack((low + horizontal + vertical + diagonal,
                       low - horizontal + vertical - diagonal), dim=-1).flatten(-2)
    bottom = torch.stack((low + horizontal - vertical - diagonal,
                          low - horizontal - vertical + diagonal), dim=-1).flatten(-2)
    return torch.stack((top, bottom), dim=-2).flatten(-3, -2) * 0.5


class MeanFlowStep(nn.Module):
    def __init__(self, checkpoint):
        super().__init__()
        self.flow = load_jpeg_model(checkpoint)

    def forward(self, image, state, time, previous_time):
        condition = self.flow.encode(image)
        state = state - (time - previous_time).reshape(1, 1, 1, 1) * self.flow.u(
            state, previous_time, time, condition
        )
        restored = condition + state / self.flow.residual_scale
        for _ in range(self.flow.model.wavelet_levels):
            restored = decode_haar(restored)
        return state, restored.clamp(0, 1)


def export(model, inputs, input_names, output_names, axes, destination):
    print(f"Exporting {destination.name}", flush=True)
    with torch.no_grad():
        torch.onnx.export(
            model.eval(), inputs, destination, input_names=input_names,
            output_names=output_names, dynamic_axes=axes, opset_version=17,
            dynamo=False,
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "meanflow_jpeg_qf5_20.pth")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(2)
    image_axes = {2: "height", 3: "width"}
    state_axes = {2: "latent_height", 3: "latent_width"}
    meanflow = MeanFlowStep(args.checkpoint)
    meanflow.flow.model.network.positional_embedding = dynamic_positions
    export(meanflow, (torch.rand(1, 3, 32, 48), torch.rand(1, 48, 8, 12),
                      torch.tensor([1.0]), torch.tensor([0.5])),
           ["image", "state", "time", "previous_time"], ["next_state", "restored"],
           {"image": image_axes, "state": state_axes, "next_state": state_axes, "restored": image_axes},
           args.output / "meanflow.onnx")
    del meanflow

    # The browser supplies edge-padded dimensions divisible by eight.
    for mode, channels in (("color", 3), ("gray", 1)):
        model = FBCNN(in_nc=channels, out_nc=channels, nc=[64, 128, 256, 512], nb=4, act_mode="R")
        checkpoint = ROOT / "checkpoints" / f"fbcnn_{mode}.pth"
        model.load_state_dict(torch.load(checkpoint, map_location="cpu", weights_only=True))
        export(model, (torch.rand(1, channels, 32, 48), torch.tensor([[0.4]])),
               ["image", "quality"], ["restored", "estimated_quality"],
               {"image": image_axes, "restored": image_axes}, args.output / f"fbcnn-{mode}.onnx")


if __name__ == "__main__":
    main()
