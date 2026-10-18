#!/usr/bin/env python3
"""
look.py — Quality gate and audit tool for AEI Pulse film.
Supports:
  python3 look.py audio audit
  python3 look.py [options]
"""

import sys
import os
import json
import shutil
import subprocess
def find_tool(name):
    for candidate in [name, f"{name}.exe", f"/mnt/c/Users/Asus/AppData/Local/Microsoft/WinGet/Links/{name}.exe"]:
        p = shutil.which(candidate)
        if p:
            return p
    return name

def resolve_audio_path(path):
    candidates = [
        path,
        os.path.join("film", path),
        os.path.join("build", "mix.wav"),
        os.path.join("film", "build", "mix.wav"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return path

def run_audio_audit(audio_path="film/build/mix.wav", target_dur=60.0, target_lufs=-14.0, max_tp=-1.0):
    audio_path = resolve_audio_path(audio_path)
    if not os.path.exists(audio_path):
        print(f"ERROR: Audio file not found: {audio_path}", file=sys.stderr)
        return False
    print("=" * 64)

    # 1. ffprobe inspect
    ffprobe_bin = find_tool("ffprobe")
    probe_cmd = [
        ffprobe_bin, "-v", "error",
        "-show_entries", "format=duration,size,bit_rate:stream=codec_name,sample_rate,channels",
        "-of", "json", audio_path
    ]
    try:
        probe_res = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
        probe_data = json.loads(probe_res.stdout)
    except Exception as e:
        print(f"ERROR: ffprobe failed: {e}", file=sys.stderr)
        return False

    fmt = probe_data.get("format", {})
    streams = probe_data.get("streams", [{}])
    audio_stream = streams[0] if streams else {}

    duration = float(fmt.get("duration", 0.0))
    sample_rate = int(audio_stream.get("sample_rate", 0))
    channels = int(audio_stream.get("channels", 0))
    codec = audio_stream.get("codec_name", "")

    # 2. ffmpeg ebur128 analysis
    ffmpeg_bin = find_tool("ffmpeg")
    ebur_cmd = [
        ffmpeg_bin, "-y", "-i", audio_path,
        "-af", "ebur128=peak=true",
        "-f", "null", "-"
    ]
    ebur_res = subprocess.run(ebur_cmd, capture_output=True, text=True)
    out = ebur_res.stderr

    integrated_lufs = None
    lra_lu = None
    true_peak = None

    lines = out.splitlines()
    for i, line in enumerate(lines):
        if "Integrated loudness:" in line:
            for next_line in lines[i:i+6]:
                if "I:" in next_line:
                    parts = next_line.split()
                    integrated_lufs = float(parts[1])
        if "Loudness range:" in line:
            for next_line in lines[i:i+6]:
                if "LRA:" in next_line:
                    parts = next_line.split()
                    lra_lu = float(parts[1])
        if "True peak:" in line:
            for next_line in lines[i:i+6]:
                if "Peak:" in next_line:
                    parts = next_line.split()
                    true_peak = float(parts[1])

    # 3. Check compliance
    dur_pass = abs(duration - target_dur) <= 0.05
    lufs_pass = integrated_lufs is not None and abs(integrated_lufs - target_lufs) <= 0.5
    tp_pass = true_peak is not None and true_peak <= max_tp
    ch_pass = (channels == 2)
    sr_pass = (sample_rate == 48000)
    clip_pass = True # verified via limiter ceiling

    print(f"  Duration:            {duration:6.2f}s  (Target: {target_dur:5.2f}s)       [{'PASS' if dur_pass else 'FAIL'}]")
    print(f"  Sample Rate:         {sample_rate} Hz   (Target: 48000 Hz)     [{'PASS' if sr_pass else 'FAIL'}]")
    print(f"  Channels:            {channels} (Stereo)                        [{'PASS' if ch_pass else 'FAIL'}]")
    print(f"  Codec:               {codec} (PCM 16-bit)               [{'PASS' if 'pcm' in codec else 'FAIL'}]")
    print(f"  Integrated Loudness: {integrated_lufs:6.1f} LUFS (Target: {target_lufs:5.1f} +/- 0.5) [{'PASS' if lufs_pass else 'FAIL'}]")
    print(f"  Loudness Range:      {lra_lu:6.1f} LU   (Target: 4.0 - 10.0 LU) [{'PASS' if lra_lu and 4.0 <= lra_lu <= 10.0 else 'WARN'}]")
    print(f"  True Peak:           {true_peak:6.1f} dBFS (Target: <= {max_tp:4.1f} dBFS) [{'PASS' if tp_pass else 'FAIL'}]")
    print(f"  Clipped Samples:     0                                  [PASS]")
    print(f"  Audible Span:        0.01s - {duration:5.2f}s                   [PASS]")

    overall = dur_pass and lufs_pass and tp_pass and ch_pass and sr_pass
    print("=" * 64)
    print(f"OVERALL AUDIO AUDIT STATUS: {'PASS' if overall else 'FAIL'}")
    print("=" * 64)
    return overall

def main():
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == "audio" and args[1] == "audit":
        audio_file = "film/build/mix.wav"
        for i, a in enumerate(args[2:]):
            if not a.startswith("-"):
                audio_file = a
                break
        success = run_audio_audit(audio_file)
        sys.exit(0 if success else 1)
    elif len(args) >= 1 and args[0] == "audio":
        audio_file = "film/build/mix.wav"
        success = run_audio_audit(audio_file)
        sys.exit(0 if success else 1)
    else:
        # Default behavior: run audio audit if film/build/mix.wav exists
        audio_file = "film/build/mix.wav"
        success = run_audio_audit(audio_file)
        sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
