from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from typing import Optional


def record_wav_from_microphone(
    *,
    duration_seconds: int,
    sample_rate: int = 16000,
    channels: int = 1,
) -> Path:
    if duration_seconds <= 0:
        raise ValueError("duration_seconds must be > 0")

    # arecord -> wav for easy Whisper loading
    with tempfile.NamedTemporaryFile(prefix="prjcap_audio_", suffix=".wav", delete=False) as f:
        out_path = Path(f.name)

    cmd = [
        "arecord",
        "-q",
        "-f",
        "S16_LE",
        "-c",
        str(channels),
        "-r",
        str(sample_rate),
        "-t",
        "wav",
        "-d",
        str(int(duration_seconds)),
        "-o",
        str(out_path),
    ]
    subprocess.run(cmd, check=True)
    return out_path


def transcribe_audio(
    *,
    audio_path: Path,
    whisper_model: str = "base",
    language: Optional[str] = None,
) -> str:
    try:
        import whisper  # type: ignore
    except Exception as e:
        raise RuntimeError(
            "Whisper is not available in the current environment. "
            "Activate `act_env_general` or install `openai-whisper`."
        ) from e

    model = whisper.load_model(whisper_model)
    result = model.transcribe(str(audio_path), language=language)
    text = (result.get("text") or "").strip()
    return text


def transcribe_from_audio_file(
    *,
    audio_path: Path,
    whisper_model: str = "base",
    language: Optional[str] = None,
) -> str:
    if not Path(audio_path).exists():
        raise ValueError(f"Audio file not found: {audio_path}")
    return transcribe_audio(audio_path=audio_path, whisper_model=whisper_model, language=language)


def transcribe_from_microphone(
    *,
    duration_seconds: int,
    whisper_model: str = "base",
    language: Optional[str] = None,
) -> str:
    wav_path = record_wav_from_microphone(duration_seconds=duration_seconds)
    try:
        return transcribe_audio(audio_path=wav_path, whisper_model=whisper_model, language=language)
    finally:
        try:
            wav_path.unlink(missing_ok=True)
        except Exception:
            pass

