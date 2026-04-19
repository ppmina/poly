from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from typing import Any

import numpy as np

from research_features import DEFAULT_ACCURACY_BAND

try:
    import torch
    from torch import nn
    from torch.utils.data import DataLoader, TensorDataset
except ImportError:  # pragma: no cover - exercised in environments without torch
    torch = None
    nn = None
    DataLoader = None
    TensorDataset = None


def sigmoid(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values, -40.0, 40.0)
    return 1.0 / (1.0 + np.exp(-clipped))


def torch_available() -> bool:
    return torch is not None and nn is not None and DataLoader is not None and TensorDataset is not None


def available_training_backends() -> list[str]:
    backends = ["numpy"]
    if torch_available():
        backends.insert(0, "torch")
    return backends


def resolve_training_backend(requested_backend: str) -> str:
    normalized = requested_backend.strip().lower()
    if normalized not in {"auto", "numpy", "torch"}:
        raise ValueError(f"Unsupported backend: {requested_backend}")

    if normalized == "auto":
        return "torch" if torch_available() else "numpy"

    if normalized == "torch" and not torch_available():
        raise RuntimeError(
            "PyTorch is not installed. Run `uv sync --extra train` or choose `--backend numpy`.",
        )

    return normalized


def resolve_torch_device(requested_device: str) -> str:
    if not torch_available():
        return "cpu"

    normalized = requested_device.strip().lower()
    if normalized == "auto":
        if torch.cuda.is_available():
            return "cuda"
        mps_backend = getattr(torch.backends, "mps", None)
        if mps_backend is not None and mps_backend.is_available():
            return "mps"
        return "cpu"

    if normalized == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("Requested CUDA training, but CUDA is not available.")
        return normalized

    if normalized == "mps":
        mps_backend = getattr(torch.backends, "mps", None)
        if mps_backend is None or not mps_backend.is_available():
            raise RuntimeError("Requested MPS training, but MPS is not available.")
        return normalized

    if normalized == "cpu":
        return normalized

    raise ValueError(f"Unsupported device: {requested_device}")


class DenseLayer:
    def __init__(self, in_features: int, out_features: int, rng: np.random.Generator) -> None:
        scale = np.sqrt(2.0 / max(1, in_features))
        self.weight = rng.normal(0.0, scale, size=(in_features, out_features))
        self.bias = np.zeros(out_features, dtype=np.float64)
        self.grad_weight = np.zeros_like(self.weight)
        self.grad_bias = np.zeros_like(self.bias)
        self._input: np.ndarray | None = None

    def forward(self, values: np.ndarray, training: bool) -> np.ndarray:
        del training
        self._input = values
        return values @ self.weight + self.bias

    def backward(self, grad_output: np.ndarray) -> np.ndarray:
        if self._input is None:
            raise RuntimeError("DenseLayer.backward called before forward")
        self.grad_weight = self._input.T @ grad_output
        self.grad_bias = grad_output.sum(axis=0)
        return grad_output @ self.weight.T

    def parameters(self) -> list[tuple[np.ndarray, np.ndarray]]:
        return [(self.weight, self.grad_weight), (self.bias, self.grad_bias)]


class LayerNormLayer:
    def __init__(self, features: int, eps: float = 1e-5) -> None:
        self.gamma = np.ones(features, dtype=np.float64)
        self.beta = np.zeros(features, dtype=np.float64)
        self.grad_gamma = np.zeros_like(self.gamma)
        self.grad_beta = np.zeros_like(self.beta)
        self.eps = eps
        self._centered: np.ndarray | None = None
        self._inv_std: np.ndarray | None = None
        self._normalized: np.ndarray | None = None

    def forward(self, values: np.ndarray, training: bool) -> np.ndarray:
        del training
        mean = values.mean(axis=1, keepdims=True)
        centered = values - mean
        var = np.mean(centered * centered, axis=1, keepdims=True)
        inv_std = 1.0 / np.sqrt(var + self.eps)
        normalized = centered * inv_std
        self._centered = centered
        self._inv_std = inv_std
        self._normalized = normalized
        return normalized * self.gamma + self.beta

    def backward(self, grad_output: np.ndarray) -> np.ndarray:
        if self._centered is None or self._inv_std is None or self._normalized is None:
            raise RuntimeError("LayerNormLayer.backward called before forward")

        normalized = self._normalized
        centered = self._centered
        inv_std = self._inv_std
        feature_count = grad_output.shape[1]

        self.grad_gamma = np.sum(grad_output * normalized, axis=0)
        self.grad_beta = np.sum(grad_output, axis=0)

        grad_normalized = grad_output * self.gamma
        grad_var = np.sum(
            grad_normalized * centered * -0.5 * (inv_std**3),
            axis=1,
            keepdims=True,
        )
        grad_mean = (
            np.sum(grad_normalized * -inv_std, axis=1, keepdims=True)
            + grad_var * np.mean(-2.0 * centered, axis=1, keepdims=True)
        )
        return (
            grad_normalized * inv_std
            + grad_var * 2.0 * centered / feature_count
            + grad_mean / feature_count
        )

    def parameters(self) -> list[tuple[np.ndarray, np.ndarray]]:
        return [(self.gamma, self.grad_gamma), (self.beta, self.grad_beta)]


class ReLULayer:
    def __init__(self) -> None:
        self._mask: np.ndarray | None = None

    def forward(self, values: np.ndarray, training: bool) -> np.ndarray:
        del training
        self._mask = values > 0
        return np.where(self._mask, values, 0.0)

    def backward(self, grad_output: np.ndarray) -> np.ndarray:
        if self._mask is None:
            raise RuntimeError("ReLULayer.backward called before forward")
        return grad_output * self._mask

    def parameters(self) -> list[tuple[np.ndarray, np.ndarray]]:
        return []


class DropoutLayer:
    def __init__(self, rate: float, rng: np.random.Generator) -> None:
        self.rate = rate
        self.rng = rng
        self._mask: np.ndarray | None = None

    def forward(self, values: np.ndarray, training: bool) -> np.ndarray:
        if not training or self.rate <= 0:
            self._mask = None
            return values

        keep_prob = 1.0 - self.rate
        mask = (self.rng.random(values.shape) < keep_prob).astype(np.float64)
        mask = mask / max(keep_prob, 1e-8)
        self._mask = mask
        return values * mask

    def backward(self, grad_output: np.ndarray) -> np.ndarray:
        if self._mask is None:
            return grad_output
        return grad_output * self._mask

    def parameters(self) -> list[tuple[np.ndarray, np.ndarray]]:
        return []


class MLPBlock:
    def __init__(self, in_features: int, out_features: int, dropout: float, rng: np.random.Generator) -> None:
        self.dense = DenseLayer(in_features, out_features, rng)
        self.layer_norm = LayerNormLayer(out_features)
        self.activation = ReLULayer()
        self.dropout = DropoutLayer(dropout, rng)

    def forward(self, values: np.ndarray, training: bool) -> np.ndarray:
        values = self.dense.forward(values, training)
        values = self.layer_norm.forward(values, training)
        values = self.activation.forward(values, training)
        return self.dropout.forward(values, training)

    def backward(self, grad_output: np.ndarray) -> np.ndarray:
        grad_output = self.dropout.backward(grad_output)
        grad_output = self.activation.backward(grad_output)
        grad_output = self.layer_norm.backward(grad_output)
        return self.dense.backward(grad_output)

    def parameters(self) -> list[tuple[np.ndarray, np.ndarray]]:
        params: list[tuple[np.ndarray, np.ndarray]] = []
        params.extend(self.dense.parameters())
        params.extend(self.layer_norm.parameters())
        return params


class NumpyMLP:
    def __init__(
        self,
        input_dim: int,
        hidden_sizes: tuple[int, ...] = (64, 32),
        dropout: float = 0.1,
        seed: int = 7,
    ) -> None:
        self.input_dim = input_dim
        self.hidden_sizes = hidden_sizes
        self.dropout = dropout
        self.seed = seed
        self.rng = np.random.default_rng(seed)

        self.blocks: list[MLPBlock] = []
        previous_size = input_dim
        for size in hidden_sizes:
            block = MLPBlock(previous_size, size, dropout, self.rng)
            self.blocks.append(block)
            previous_size = size
        self.output = DenseLayer(previous_size, 2, self.rng)

    def forward(self, values: np.ndarray, training: bool = False) -> np.ndarray:
        activations = values
        for block in self.blocks:
            activations = block.forward(activations, training)
        return self.output.forward(activations, training)

    def backward(self, grad_output: np.ndarray) -> None:
        grad = self.output.backward(grad_output)
        for block in reversed(self.blocks):
            grad = block.backward(grad)

    def parameters(self) -> list[tuple[np.ndarray, np.ndarray]]:
        params: list[tuple[np.ndarray, np.ndarray]] = []
        for block in self.blocks:
            params.extend(block.parameters())
        params.extend(self.output.parameters())
        return params

    def serialize(self) -> dict[str, np.ndarray]:
        payload: dict[str, np.ndarray] = {}
        for index, block in enumerate(self.blocks):
            payload[f"block_{index}_dense_weight"] = block.dense.weight
            payload[f"block_{index}_dense_bias"] = block.dense.bias
            payload[f"block_{index}_norm_gamma"] = block.layer_norm.gamma
            payload[f"block_{index}_norm_beta"] = block.layer_norm.beta
        payload["output_weight"] = self.output.weight
        payload["output_bias"] = self.output.bias
        return payload

    def load_state(self, state: dict[str, np.ndarray]) -> None:
        for index, block in enumerate(self.blocks):
            block.dense.weight[...] = state[f"block_{index}_dense_weight"]
            block.dense.bias[...] = state[f"block_{index}_dense_bias"]
            block.layer_norm.gamma[...] = state[f"block_{index}_norm_gamma"]
            block.layer_norm.beta[...] = state[f"block_{index}_norm_beta"]
        self.output.weight[...] = state["output_weight"]
        self.output.bias[...] = state["output_bias"]


class AdamOptimizer:
    def __init__(self, learning_rate: float, beta1: float = 0.9, beta2: float = 0.999, eps: float = 1e-8) -> None:
        self.learning_rate = learning_rate
        self.beta1 = beta1
        self.beta2 = beta2
        self.eps = eps
        self._moments: list[tuple[np.ndarray, np.ndarray]] = []
        self._step = 0

    def step(self, parameters: list[tuple[np.ndarray, np.ndarray]], weight_decay: float = 0.0) -> None:
        if not self._moments:
            self._moments = [
                (np.zeros_like(param, dtype=np.float64), np.zeros_like(param, dtype=np.float64))
                for param, _ in parameters
            ]

        self._step += 1
        for index, (param, grad) in enumerate(parameters):
            adjusted_grad = grad + weight_decay * param if weight_decay and param.ndim > 1 else grad
            first_moment, second_moment = self._moments[index]
            first_moment[...] = self.beta1 * first_moment + (1.0 - self.beta1) * adjusted_grad
            second_moment[...] = self.beta2 * second_moment + (1.0 - self.beta2) * (
                adjusted_grad * adjusted_grad
            )

            corrected_first = first_moment / (1.0 - self.beta1**self._step)
            corrected_second = second_moment / (1.0 - self.beta2**self._step)
            param[...] = param - self.learning_rate * corrected_first / (
                np.sqrt(corrected_second) + self.eps
            )


if torch_available():

    class TorchBlock(nn.Module):
        def __init__(self, in_features: int, out_features: int, dropout: float) -> None:
            super().__init__()
            self.dense = nn.Linear(in_features, out_features)
            self.layer_norm = nn.LayerNorm(out_features)
            self.activation = nn.ReLU()
            self.dropout = nn.Dropout(dropout)

        def forward(self, values: Any) -> Any:
            values = self.dense(values)
            values = self.layer_norm(values)
            values = self.activation(values)
            return self.dropout(values)


    class TorchMLP(nn.Module):
        def __init__(
            self,
            input_dim: int,
            hidden_sizes: tuple[int, ...] = (64, 32),
            dropout: float = 0.1,
        ) -> None:
            super().__init__()
            self.hidden_sizes = hidden_sizes
            self.dropout = dropout
            self.blocks = nn.ModuleList()
            previous_size = input_dim
            for size in hidden_sizes:
                self.blocks.append(TorchBlock(previous_size, size, dropout))
                previous_size = size
            self.output = nn.Linear(previous_size, 2)

        def forward(self, values: Any) -> Any:
            activations = values
            for block in self.blocks:
                activations = block(activations)
            return self.output(activations)


@dataclass(slots=True)
class TrainingConfig:
    hidden_sizes: tuple[int, ...] = (64, 32)
    dropout: float = 0.1
    learning_rate: float = 0.003
    batch_size: int = 32
    epochs: int = 120
    weight_decay: float = 1e-4
    seed: int = 7
    time_budget_seconds: float = 300.0
    confidence_loss_weight: float = 0.15
    backend: str = "auto"
    device: str = "auto"

    def to_dict(self) -> dict[str, Any]:
        return {
            "hiddenSizes": list(self.hidden_sizes),
            "dropout": self.dropout,
            "learningRate": self.learning_rate,
            "batchSize": self.batch_size,
            "epochs": self.epochs,
            "weightDecay": self.weight_decay,
            "seed": self.seed,
            "timeBudgetSeconds": self.time_budget_seconds,
            "confidenceLossWeight": self.confidence_loss_weight,
            "backend": self.backend,
            "device": self.device,
        }


def standardize_features(
    train_x: np.ndarray,
    val_x: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    mean = train_x.mean(axis=0)
    std = train_x.std(axis=0)
    std = np.where(std < 1e-6, 1.0, std)
    return (train_x - mean) / std, (val_x - mean) / std, mean, std


def evaluate_predictions(
    predicted_delta: np.ndarray,
    target_delta: np.ndarray,
    base_fair_value: np.ndarray,
    future_midpoint: np.ndarray,
) -> dict[str, float]:
    predicted_future_midpoint = base_fair_value + predicted_delta
    abs_error = np.abs(predicted_future_midpoint - future_midpoint)
    direction_matches = np.sign(predicted_delta) == np.sign(target_delta)
    return {
        "mae": float(np.mean(abs_error)),
        "directionalAccuracy": float(np.mean(direction_matches)),
        "bandAccuracy": float(np.mean(abs_error <= DEFAULT_ACCURACY_BAND)),
        "meanAbsoluteDelta": float(np.mean(np.abs(predicted_delta))),
    }


def calibrate_confidence(
    predicted_delta: float,
    raw_confidence: float,
    reliability_factor: float,
    delta_scale: float,
) -> float:
    magnitude_confidence = min(abs(predicted_delta) / max(delta_scale, 1e-6), 1.0)
    blended = 0.4 * raw_confidence + 0.6 * magnitude_confidence
    return float(max(0.05, min(1.0, blended * reliability_factor)))


def save_checkpoint(
    path: str | Path,
    model_state: dict[str, np.ndarray],
    metadata: dict[str, Any],
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
) -> None:
    payload = dict(model_state)
    payload["feature_mean"] = feature_mean
    payload["feature_std"] = feature_std
    payload["metadata_json"] = np.array(json.dumps(metadata, sort_keys=True))
    np.savez_compressed(path, **payload)


def load_checkpoint(path: str | Path) -> tuple[NumpyMLP, dict[str, Any], np.ndarray, np.ndarray]:
    checkpoint = np.load(path, allow_pickle=False)
    metadata = json.loads(str(checkpoint["metadata_json"].item()))
    model = NumpyMLP(
        input_dim=int(metadata["inputDim"]),
        hidden_sizes=tuple(int(value) for value in metadata["hiddenSizes"]),
        dropout=float(metadata["dropout"]),
        seed=int(metadata.get("seed", 7)),
    )
    state = {
        key: checkpoint[key]
        for key in checkpoint.files
        if key not in {"feature_mean", "feature_std", "metadata_json"}
    }
    model.load_state(state)
    return model, metadata, checkpoint["feature_mean"], checkpoint["feature_std"]


def append_history_line(path: str | Path, payload: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(f"{json.dumps(payload, sort_keys=True)}\n")


def _compute_reliability_factor(metrics: dict[str, float]) -> float:
    return float(
        np.clip(
            0.5 * metrics["bandAccuracy"]
            + 0.5 * max(0.0, 1.0 - metrics["mae"] / DEFAULT_ACCURACY_BAND),
            0.05,
            1.0,
        ),
    )


def _train_numpy_model(
    train_x: np.ndarray,
    train_target: np.ndarray,
    train_base_fair_value: np.ndarray,
    train_future_midpoint: np.ndarray,
    val_x: np.ndarray,
    val_target: np.ndarray,
    val_base_fair_value: np.ndarray,
    val_future_midpoint: np.ndarray,
    config: TrainingConfig,
    history_path: str | Path | None = None,
) -> dict[str, Any]:
    model = NumpyMLP(
        input_dim=train_x.shape[1],
        hidden_sizes=config.hidden_sizes,
        dropout=config.dropout,
        seed=config.seed,
    )
    optimizer = AdamOptimizer(config.learning_rate)
    rng = np.random.default_rng(config.seed)
    best_state = {name: values.copy() for name, values in model.serialize().items()}
    best_epoch = 0
    best_metrics: dict[str, float] | None = None
    start_time = monotonic()
    confidence_scale = float(max(np.percentile(np.abs(train_target), 75), DEFAULT_ACCURACY_BAND / 2))

    history: list[dict[str, Any]] = []
    for epoch in range(1, config.epochs + 1):
        if monotonic() - start_time >= config.time_budget_seconds:
            break

        permutation = rng.permutation(train_x.shape[0])
        for start in range(0, train_x.shape[0], config.batch_size):
            batch_indices = permutation[start : start + config.batch_size]
            batch_x = train_x[batch_indices]
            batch_target = train_target[batch_indices]

            network_output = model.forward(batch_x, training=True)
            predicted_delta = network_output[:, 0]
            confidence_logit = network_output[:, 1]
            confidence_proxy = sigmoid(confidence_logit)
            confidence_target = np.clip(np.abs(batch_target) / confidence_scale, 0.0, 1.0)

            delta_grad = 2.0 * (predicted_delta - batch_target) / batch_x.shape[0]
            confidence_grad = (
                2.0
                * (confidence_proxy - confidence_target)
                * confidence_proxy
                * (1.0 - confidence_proxy)
                / batch_x.shape[0]
            )
            grad_output = np.stack(
                [delta_grad, config.confidence_loss_weight * confidence_grad],
                axis=1,
            )
            model.backward(grad_output)
            optimizer.step(model.parameters(), weight_decay=config.weight_decay)

        train_output = model.forward(train_x, training=False)
        val_output = model.forward(val_x, training=False)

        train_metrics = evaluate_predictions(
            train_output[:, 0],
            train_target,
            train_base_fair_value,
            train_future_midpoint,
        )
        val_metrics = evaluate_predictions(
            val_output[:, 0],
            val_target,
            val_base_fair_value,
            val_future_midpoint,
        )
        epoch_metrics = {
            "epoch": epoch,
            "elapsedSeconds": round(monotonic() - start_time, 3),
            "backend": "numpy",
            "device": "cpu",
            "train": train_metrics,
            "validation": val_metrics,
        }
        history.append(epoch_metrics)
        if history_path is not None:
            append_history_line(history_path, epoch_metrics)

        if best_metrics is None or val_metrics["mae"] < best_metrics["mae"]:
            best_epoch = epoch
            best_metrics = val_metrics
            best_state = {name: values.copy() for name, values in model.serialize().items()}

    model.load_state(best_state)
    best_train_output = model.forward(train_x, training=False)
    best_val_output = model.forward(val_x, training=False)
    best_train_metrics = evaluate_predictions(
        best_train_output[:, 0],
        train_target,
        train_base_fair_value,
        train_future_midpoint,
    )
    best_val_metrics = evaluate_predictions(
        best_val_output[:, 0],
        val_target,
        val_base_fair_value,
        val_future_midpoint,
    )

    return {
        "modelState": best_state,
        "history": history,
        "bestEpoch": best_epoch,
        "trainMetrics": best_train_metrics,
        "validationMetrics": best_val_metrics,
        "reliabilityFactor": _compute_reliability_factor(best_val_metrics),
        "deltaScale": confidence_scale,
        "validationConfidenceProxyMean": float(np.mean(sigmoid(best_val_output[:, 1]))),
        "trainingBackend": "numpy",
        "trainingDevice": "cpu",
        "torchVersion": None,
    }


def _serialize_torch_model_state(model: Any) -> dict[str, np.ndarray]:
    payload: dict[str, np.ndarray] = {}
    for index, block in enumerate(model.blocks):
        payload[f"block_{index}_dense_weight"] = block.dense.weight.detach().cpu().numpy().T.astype(
            np.float64,
        )
        payload[f"block_{index}_dense_bias"] = block.dense.bias.detach().cpu().numpy().astype(
            np.float64,
        )
        payload[f"block_{index}_norm_gamma"] = block.layer_norm.weight.detach().cpu().numpy().astype(
            np.float64,
        )
        payload[f"block_{index}_norm_beta"] = block.layer_norm.bias.detach().cpu().numpy().astype(
            np.float64,
        )
    payload["output_weight"] = model.output.weight.detach().cpu().numpy().T.astype(np.float64)
    payload["output_bias"] = model.output.bias.detach().cpu().numpy().astype(np.float64)
    return payload


def _train_torch_model(
    train_x: np.ndarray,
    train_target: np.ndarray,
    train_base_fair_value: np.ndarray,
    train_future_midpoint: np.ndarray,
    val_x: np.ndarray,
    val_target: np.ndarray,
    val_base_fair_value: np.ndarray,
    val_future_midpoint: np.ndarray,
    config: TrainingConfig,
    history_path: str | Path | None = None,
) -> dict[str, Any]:
    if not torch_available():
        raise RuntimeError("PyTorch is not installed.")

    torch.manual_seed(config.seed)
    device_name = resolve_torch_device(config.device)
    device = torch.device(device_name)
    model = TorchMLP(
        input_dim=train_x.shape[1],
        hidden_sizes=config.hidden_sizes,
        dropout=config.dropout,
    ).to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.learning_rate,
        weight_decay=config.weight_decay,
    )
    mse_loss = nn.MSELoss()
    confidence_scale = float(max(np.percentile(np.abs(train_target), 75), DEFAULT_ACCURACY_BAND / 2))

    train_dataset = TensorDataset(
        torch.tensor(train_x, dtype=torch.float32),
        torch.tensor(train_target, dtype=torch.float32),
    )
    train_loader = DataLoader(
        train_dataset,
        batch_size=min(config.batch_size, len(train_dataset)),
        shuffle=True,
    )

    best_state = _serialize_torch_model_state(model)
    best_epoch = 0
    best_metrics: dict[str, float] | None = None
    best_confidence_proxy_mean = 0.0
    start_time = monotonic()
    history: list[dict[str, Any]] = []

    train_x_eval = torch.tensor(train_x, dtype=torch.float32, device=device)
    val_x_tensor = torch.tensor(val_x, dtype=torch.float32, device=device)
    for epoch in range(1, config.epochs + 1):
        if monotonic() - start_time >= config.time_budget_seconds:
            break

        model.train()
        for batch_x, batch_target in train_loader:
            batch_x = batch_x.to(device)
            batch_target = batch_target.to(device)
            optimizer.zero_grad(set_to_none=True)
            network_output = model(batch_x)
            predicted_delta = network_output[:, 0]
            confidence_logit = network_output[:, 1]
            confidence_proxy = torch.sigmoid(confidence_logit)
            confidence_target = torch.clamp(torch.abs(batch_target) / confidence_scale, 0.0, 1.0)

            delta_loss = mse_loss(predicted_delta, batch_target)
            confidence_loss = mse_loss(confidence_proxy, confidence_target)
            total_loss = delta_loss + config.confidence_loss_weight * confidence_loss
            total_loss.backward()
            optimizer.step()

        model.eval()
        with torch.no_grad():
            train_output = model(train_x_eval).detach().cpu().numpy()
            val_output = model(val_x_tensor).detach().cpu().numpy()

        train_metrics = evaluate_predictions(
            train_output[:, 0],
            train_target,
            train_base_fair_value,
            train_future_midpoint,
        )
        val_metrics = evaluate_predictions(
            val_output[:, 0],
            val_target,
            val_base_fair_value,
            val_future_midpoint,
        )
        epoch_metrics = {
            "epoch": epoch,
            "elapsedSeconds": round(monotonic() - start_time, 3),
            "backend": "torch",
            "device": device_name,
            "train": train_metrics,
            "validation": val_metrics,
        }
        history.append(epoch_metrics)
        if history_path is not None:
            append_history_line(history_path, epoch_metrics)

        if best_metrics is None or val_metrics["mae"] < best_metrics["mae"]:
            best_epoch = epoch
            best_metrics = val_metrics
            best_state = _serialize_torch_model_state(model)
            best_confidence_proxy_mean = float(np.mean(sigmoid(val_output[:, 1])))

    numpy_model = NumpyMLP(
        input_dim=train_x.shape[1],
        hidden_sizes=config.hidden_sizes,
        dropout=config.dropout,
        seed=config.seed,
    )
    numpy_model.load_state(best_state)
    best_train_output = numpy_model.forward(train_x, training=False)
    best_val_output = numpy_model.forward(val_x, training=False)
    best_train_metrics = evaluate_predictions(
        best_train_output[:, 0],
        train_target,
        train_base_fair_value,
        train_future_midpoint,
    )
    best_val_metrics = evaluate_predictions(
        best_val_output[:, 0],
        val_target,
        val_base_fair_value,
        val_future_midpoint,
    )

    return {
        "modelState": best_state,
        "history": history,
        "bestEpoch": best_epoch,
        "trainMetrics": best_train_metrics,
        "validationMetrics": best_val_metrics,
        "reliabilityFactor": _compute_reliability_factor(best_val_metrics),
        "deltaScale": confidence_scale,
        "validationConfidenceProxyMean": best_confidence_proxy_mean,
        "trainingBackend": "torch",
        "trainingDevice": device_name,
        "torchVersion": torch.__version__,
    }


def train_model(
    train_x: np.ndarray,
    train_target: np.ndarray,
    train_base_fair_value: np.ndarray,
    train_future_midpoint: np.ndarray,
    val_x: np.ndarray,
    val_target: np.ndarray,
    val_base_fair_value: np.ndarray,
    val_future_midpoint: np.ndarray,
    config: TrainingConfig,
    history_path: str | Path | None = None,
) -> dict[str, Any]:
    backend = resolve_training_backend(config.backend)
    if backend == "torch":
        return _train_torch_model(
            train_x,
            train_target,
            train_base_fair_value,
            train_future_midpoint,
            val_x,
            val_target,
            val_base_fair_value,
            val_future_midpoint,
            config,
            history_path,
        )

    return _train_numpy_model(
        train_x,
        train_target,
        train_base_fair_value,
        train_future_midpoint,
        val_x,
        val_target,
        val_base_fair_value,
        val_future_midpoint,
        config,
        history_path,
    )
