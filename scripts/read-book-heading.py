"""Optional offline speech reader: bounded mono 16 kHz PCM on stdin, JSON out.

Uses an existing local Whisper installation and model. Never downloads models,
accepts audio paths/URLs, writes audio, or receives Freeqify credentials.
"""
import json
import os
import pathlib
import resource
import sys

resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
os.nice(5)
model_path = pathlib.Path(sys.argv[1])
if not model_path.is_file() or not 0 < model_path.stat().st_size <= 2 * 1024**3:
    raise ValueError("An existing local model is required")
pcm = sys.stdin.buffer.read(45 * 16000 * 2 + 1)
if not 3200 <= len(pcm) <= 45 * 16000 * 2 or len(pcm) % 2:
    raise ValueError("Invalid bounded PCM")

import numpy as np
import torch
import whisper

torch.set_num_threads(2)
torch.set_num_interop_threads(1)
audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
# Silence is not a heading. Avoid asking the recognizer to invent words for it.
if float(np.sqrt(np.mean(audio**2))) < 0.001:
    print("[]")
else:
    model = whisper.load_model(str(model_path), device="cpu")
    result = model.transcribe(audio, task="transcribe", fp16=False, verbose=None,
                              temperature=0, condition_on_previous_text=False)
    keys = ("start", "end", "text", "avg_logprob", "no_speech_prob", "compression_ratio")
    print(json.dumps([{key: segment[key] for key in keys}
                      for segment in result["segments"][:100]], ensure_ascii=True))
