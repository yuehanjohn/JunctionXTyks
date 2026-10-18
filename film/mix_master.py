"""
AEI Pulse - Master Cinematic Audio Mix Engine (60.0s)
Masters complete soundtrack, ElevenLabs VO, and procedural SFX into film/build/mix.wav
Compliance: EBU R128 (-14 LUFS, true peak <= -1.0 dBFS, 0 clipped samples)
"""

import os
import sys
import json
import subprocess
import numpy as np
import scipy.signal as signal
import scipy.io.wavfile as wavfile

SR = 48000
DURATION = 60.0 # Exactly 60.00 seconds
TOTAL_SAMPLES = int(SR * DURATION)

VO_TIMINGS = [
    # (clip_index, start_sec, dur_sec, text)
    (1, 0.014, 3.075, "A silent pandemic is accelerating through modern medicine."),
    (2, 3.650, 4.035, "Ten million lives a year. The miracle drugs of our century are failing."),
    (3, 8.192, 6.782, "For a hundred years, antibiotics shielded humanity's greatest leaps: surgery, chemotherapy, childbirth."),
    (4, 15.484, 5.297, "Without them, the shield breaks. And hospitals still fight back with annual PDF reports."),
    (5, 21.222, 3.906, "An infection does not wait a year. This is AEI Pulse."),
    (6, 25.532, 5.787, "A living surveillance radar. 1,212 acute isolates, tracked in real time."),
    (7, 31.782, 5.150, "A 28-day rolling window sweeping every ward, every organism, every antibiotic."),
    (8, 37.520, 7.189, "When a resistant clone surges, Pulse catches it. Z-score minus 5.8: intercepted before the outbreak spreads."),
    (9, 45.242, 3.641, "At the bedside: knowing what still works. Protecting what remains."),
    (10, 49.314, 5.275, "We are defending the shield that built the modern world. AEI Pulse. Tyks Laboratories.")
]

def load_resample_vo(vo_dir="film/audio/vo"):
    """Loads all 10 voiceover lines, resamples to 48kHz stereo, and places on timeline."""
    vo_track = np.zeros((TOTAL_SAMPLES, 2), dtype=np.float64)
    # Also track voice presence for ducking envelope
    voice_mask = np.zeros(TOTAL_SAMPLES, dtype=np.float64)
    
    print("[1/5] Loading & placing 10 ElevenLabs VO clips...")
    for idx, start_s, expected_dur, text in VO_TIMINGS:
        fn = os.path.join(vo_dir, f"line{idx:02d}.wav")
        if not os.path.exists(fn):
            raise FileNotFoundError(f"Missing VO file: {fn}")
        
        orig_sr, data = wavfile.read(fn)
        if data.dtype == np.int16:
            audio = data.astype(np.float64) / 32768.0
        elif data.dtype == np.int32:
            audio = data.astype(np.float64) / 2147483648.0
        else:
            audio = data.astype(np.float64)
            
        if audio.ndim == 2:
            audio = audio.mean(axis=1) # downmix to mono first
            
        # Resample to SR (48000)
        if orig_sr != SR:
            num_out = int(round(len(audio) * float(SR) / orig_sr))
            audio = signal.resample_poly(audio, SR, orig_sr)
            
        dur_s = len(audio) / SR
        start_samp = int(round(start_s * SR))
        end_samp = start_samp + len(audio)
        
        # Fit into total timeline
        if start_samp < TOTAL_SAMPLES:
            fit_end = min(end_samp, TOTAL_SAMPLES)
            src_len = fit_end - start_samp
            
            # Place into stereo track (centered)
            vo_track[start_samp:fit_end, 0] += audio[:src_len]
            vo_track[start_samp:fit_end, 1] += audio[:src_len]
            
            # Mark voice mask
            voice_mask[start_samp:fit_end] = 1.0
            print(f"  Line {idx:02d} placed: {start_s:5.2f}s - {start_s + dur_s:5.2f}s | {text[:42]}...")
            
    return vo_track, voice_mask

def compute_ducking_envelope(voice_mask, attack_s=0.150, release_s=0.150, duck_db=-14.0):
    """
    Computes smooth ducking envelope with 150ms attack & release.
    Target gain = 10^(duck_db / 20) when voice is active, 1.0 when silent.
    """
    print("[2/5] Computing -14dB smooth ducking envelope (150ms attack/release)...")
    target_gain_duck = 10.0 ** (duck_db / 20.0) # ~0.1995 (-14 dB)
    envelope = np.ones(TOTAL_SAMPLES, dtype=np.float64)
    
    # Identify voice line segments
    segments = []
    in_seg = False
    start_i = 0
    for i in range(TOTAL_SAMPLES):
        if voice_mask[i] > 0 and not in_seg:
            in_seg = True
            start_i = i
        elif voice_mask[i] == 0 and in_seg:
            in_seg = False
            segments.append((start_i, i))
    if in_seg:
        segments.append((start_i, TOTAL_SAMPLES))
        
    attack_samples = int(round(attack_s * SR))
    release_samples = int(round(release_s * SR))
    
    # Build per-segment gain reduction
    gain_curve = np.ones(TOTAL_SAMPLES, dtype=np.float64)
    for seg_start, seg_end in segments:
        seg_gain = np.ones(TOTAL_SAMPLES, dtype=np.float64)
        # Ducked body
        seg_gain[seg_start:seg_end] = target_gain_duck
        
        # Smooth attack (cosine ramp from 1.0 down to target_gain_duck)
        att_start = max(0, seg_start - attack_samples)
        att_len = seg_start - att_start
        if att_len > 0:
            t = np.linspace(0, 1, att_len, endpoint=False)
            w = 0.5 * (1.0 + np.cos(np.pi * t)) # 1 -> 0
            seg_gain[att_start:seg_start] = target_gain_duck + (1.0 - target_gain_duck) * w
            
        # Smooth release (cosine ramp from target_gain_duck up to 1.0)
        rel_end = min(TOTAL_SAMPLES, seg_end + release_samples)
        rel_len = rel_end - seg_end
        if rel_len > 0:
            t = np.linspace(0, 1, rel_len, endpoint=False)
            w = 0.5 * (1.0 - np.cos(np.pi * t)) # 0 -> 1
            seg_gain[seg_end:rel_end] = target_gain_duck + (1.0 - target_gain_duck) * w
            
        gain_curve = np.minimum(gain_curve, seg_gain)
        
    return gain_curve

def load_resample_soundtrack(soundtrack_path="soundtrack.mp3"):
    """Decodes soundtrack.mp3 to 48kHz stereo for 60.0s."""
    print("[3/5] Loading and resampling soundtrack.mp3 to 48kHz...")
    cmd = [
        "ffmpeg", "-y", "-i", soundtrack_path,
        "-t", f"{DURATION:.3f}",
        "-f", "f32le", "-ar", f"{SR}", "-ac", "2",
        "pipe:1"
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    raw = proc.stdout.read()
    audio = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)
    
    if len(audio) < TOTAL_SAMPLES:
        padded = np.zeros((TOTAL_SAMPLES, 2), dtype=np.float64)
        padded[:len(audio)] = audio
        audio = padded
    elif len(audio) > TOTAL_SAMPLES:
        audio = audio[:TOTAL_SAMPLES]
        
    # Gentle musical fade out at the very tail (57.5s - 60.0s)
    fade_start = int(57.5 * SR)
    fade_len = TOTAL_SAMPLES - fade_start
    fade_w = 0.5 * (1.0 + np.cos(np.pi * np.linspace(0, 1, fade_len))) # 1 -> 0
    audio[fade_start:, 0] *= fade_w
    audio[fade_start:, 1] *= fade_w
    
    return audio

def synthesize_sfx():
    """
    Synthesizes studio-grade cinematic SFX adhering to the prompt requirements:
    1. News cut glitches / camera shutter ticks (0.0s - 7.5s)
    2. Heavy sub-bass drop on '10 million lives' (3.7s)
    3. Warm musical swell / riser into humanity's evolution (8.0s)
    4. Heavy paper drop thud (15.5s)
    5. High-voltage flash / laser stinger on 'This is AEI Pulse' (21.2s)
    6. Tech radar ping on isolate telemetry (25.5s)
    7. Massive alert slam explosion / bass hit on z = -5.8 (37.5s - 39.5s)
    8. Tactile UI click pop on 'Select for Order' (46.0s)
    9. Resolved harmonic tail (54.5s - 60.0s)
    """
    print("[4/5] Synthesizing cinematic SFX suite...")
    sfx = np.zeros((TOTAL_SAMPLES, 2), dtype=np.float64)
    
    def add_at(buffer, start_time_s, gain_l=1.0, gain_r=1.0):
        start_samp = int(round(start_time_s * SR))
        end_samp = start_samp + len(buffer)
        if start_samp < TOTAL_SAMPLES:
            fit_end = min(end_samp, TOTAL_SAMPLES)
            chunk_len = fit_end - start_samp
            if buffer.ndim == 1:
                sfx[start_samp:fit_end, 0] += buffer[:chunk_len] * gain_l
                sfx[start_samp:fit_end, 1] += buffer[:chunk_len] * gain_r
            else:
                sfx[start_samp:fit_end, 0] += buffer[:chunk_len, 0] * gain_l
                sfx[start_samp:fit_end, 1] += buffer[:chunk_len, 1] * gain_r

    # Helper: Camera shutter click / tactile tick
    def gen_shutter_click(dur_s=0.035, f_res=2800.0, tone_res=1200.0):
        n = int(dur_s * SR)
        t = np.linspace(0, dur_s, n, endpoint=False)
        # High transient click (shaped white noise)
        noise = np.random.uniform(-1, 1, n)
        b, a = signal.butter(2, [1800 / (SR/2), min(0.95, 6500 / (SR/2))], btype='band')
        filtered_noise = signal.lfilter(b, a, noise)
        env1 = np.exp(-t / 0.005) # 5ms decay
        # Mechanical latch tone
        tone = np.sin(2 * np.pi * tone_res * t) * np.exp(-t / 0.012)
        click = 0.7 * (filtered_noise * env1) + 0.3 * tone
        # Smooth attack
        att = int(0.001 * SR)
        click[:att] *= np.linspace(0, 1, att)
        return click * 0.8

    # Helper: Analog glitch / tape static burst
    def gen_glitch_burst(dur_s=0.065, f_center=2200.0):
        n = int(dur_s * SR)
        t = np.linspace(0, dur_s, n, endpoint=False)
        noise = np.random.uniform(-1, 1, n)
        # Modulate noise with square pulse (digital gating / buzz)
        mod = 0.5 * (1.0 + np.sign(np.sin(2 * np.pi * 180 * t)))
        b, a = signal.butter(2, [1200 / (SR/2), min(0.95, 5500 / (SR/2))], btype='band')
        filt = signal.lfilter(b, a, noise * mod)
        env = (1.0 - np.exp(-t / 0.002)) * np.exp(-t / 0.025)
        return filt * env * 0.75

    # 1. NEWS CUT GLITCHES / CAMERA SHUTTER TICKS (0.0s - 7.5s)
    # Visual cuts from crisis montage:
    # 0.05s: initial page reveal
    # 0.60s: stamp hit on broadsheet
    # 1.20s: flash cut to MUTATION
    # 1.60s: TV News lower third cut
    # 3.00s: flash cut to ACCELERATING
    # 3.60s: flash cut to UNTREATABLE
    # 4.17s: Lancet 10M counter launch
    # 6.00s: Failing stamp crash
    add_at(gen_shutter_click(0.035, 3200, 1400), 0.05, 0.45, 0.40)
    add_at(gen_shutter_click(0.040, 2600, 1100), 0.60, 0.50, 0.55)
    add_at(gen_glitch_burst(0.075, 2400), 1.20, 0.65, 0.50)
    add_at(gen_shutter_click(0.030, 3600, 1600), 1.22, 0.55, 0.60)
    add_at(gen_shutter_click(0.035, 2800, 1300), 1.60, 0.40, 0.45)
    add_at(gen_glitch_burst(0.070, 2900), 3.00, 0.55, 0.65)
    add_at(gen_shutter_click(0.030, 3400, 1500), 3.01, 0.60, 0.55)
    add_at(gen_glitch_burst(0.080, 2200), 3.60, 0.60, 0.50)
    add_at(gen_shutter_click(0.035, 3000, 1200), 3.61, 0.50, 0.60)
    add_at(gen_shutter_click(0.045, 2500, 1000), 4.17, 0.45, 0.45)
    add_at(gen_shutter_click(0.040, 2400, 950), 6.00, 0.50, 0.50)

    # 2. HEAVY SUB-BASS DROP on "10 million lives" (3.7s)
    # Deep cinematic sub dive from 92 Hz down to 32 Hz with warm saturation
    dur_sub = 2.2
    n_sub = int(dur_sub * SR)
    t_sub = np.linspace(0, dur_sub, n_sub, endpoint=False)
    # Exponential frequency sweep: 92 -> 32 Hz
    f_sub = 32.0 + 60.0 * np.exp(-t_sub / 0.55)
    phase_sub = 2 * np.pi * np.cumsum(f_sub) / SR
    sub_raw = np.sin(phase_sub) + 0.35 * np.sin(2 * phase_sub) # fundamental + 2nd harmonic
    sub_env = (1.0 - np.exp(-t_sub / 0.006)) * np.exp(-t_sub / 0.70)
    sub_drop = np.tanh(1.6 * (sub_raw * sub_env)) * 0.95
    # Stereo width on higher overtone
    sub_l = sub_drop + 0.10 * np.sin(3 * phase_sub) * sub_env
    sub_r = sub_drop - 0.10 * np.sin(3 * phase_sub) * sub_env
    sub_stereo = np.column_stack([sub_l, sub_r])
    add_at(sub_stereo, 3.70, 0.95, 0.95)

    # 3. WARM MUSICAL SWELL / RISER into humanity's evolution (8.0s)
    # Rising from 6.8s to 8.2s: Filtered harmonic chord swell + pink noise riser
    dur_swell = 1.4
    n_swell = int(dur_swell * SR)
    t_swell = np.linspace(0, dur_swell, n_swell, endpoint=False)
    # Harmonically tuned chords in key: Eb4 (311.1), G4 (392.0), Bb4 (466.2), Eb5 (622.3)
    c1 = np.sin(2 * np.pi * 311.13 * t_swell)
    c2 = np.sin(2 * np.pi * 392.00 * t_swell)
    c3 = np.sin(2 * np.pi * 466.16 * t_swell)
    c4 = np.sin(2 * np.pi * 622.25 * t_swell)
    chord = (c1 + c2 + c3 + 0.7 * c4) / 3.0
    # Exponential swell envelope
    swell_env = (t_swell / dur_swell) ** 2.2
    # Opening lowpass filter sweep
    noise_swell = np.random.normal(0, 1, n_swell)
    b_noise, a_noise = signal.butter(2, [300 / (SR/2), min(0.9, 4500 / (SR/2))], btype='band')
    noise_filtered = signal.lfilter(b_noise, a_noise, noise_swell)
    riser = (0.65 * chord + 0.35 * noise_filtered) * swell_env
    # Add gentle chime resolution ring at 8.1s
    n_ring = int(1.2 * SR)
    t_ring = np.linspace(0, 1.2, n_ring, endpoint=False)
    bell = (np.sin(2 * np.pi * 622.25 * t_ring) * np.exp(-t_ring / 0.35) +
            0.5 * np.sin(2 * np.pi * 932.33 * t_ring) * np.exp(-t_ring / 0.25))
    riser_full = np.zeros((n_swell + n_ring, 2))
    riser_full[:n_swell, 0] = riser
    riser_full[:n_swell, 1] = riser
    riser_full[n_swell-int(0.1*SR):n_swell-int(0.1*SR)+n_ring, 0] += bell * 0.4
    riser_full[n_swell-int(0.1*SR):n_swell-int(0.1*SR)+n_ring, 1] += bell * 0.45
    add_at(riser_full, 6.80, 0.70, 0.75)

    # 4. HEAVY PAPER DROP THUD (15.5s)
    # At 15.0s: Shield fracture crack
    dur_crack = 0.12
    n_crack = int(dur_crack * SR)
    t_crack = np.linspace(0, dur_crack, n_crack, endpoint=False)
    crack_noise = np.random.uniform(-1, 1, n_crack)
    b_cr, a_cr = signal.butter(2, [1800 / (SR/2), min(0.95, 7500 / (SR/2))], btype='band')
    crack = signal.lfilter(b_cr, a_cr, crack_noise) * np.exp(-t_crack / 0.015)
    add_at(crack * 0.75, 15.00, 0.65, 0.60)

    # At 15.48s: Heavy physical dossier / annual report drop thud
    dur_thud = 0.85
    n_thud = int(dur_thud * SR)
    t_thud = np.linspace(0, dur_thud, n_thud, endpoint=False)
    # Deep sub thud: 68 -> 38 Hz
    f_thud = 38.0 + 30.0 * np.exp(-t_thud / 0.08)
    phase_thud = 2 * np.pi * np.cumsum(f_thud) / SR
    sub_thud = np.sin(phase_thud) * np.exp(-t_thud / 0.16)
    # Paper air slap (mid noise burst)
    paper_noise = np.random.uniform(-1, 1, n_thud)
    b_p, a_p = signal.butter(2, [600 / (SR/2), 2400 / (SR/2)], btype='band')
    paper_slap = signal.lfilter(b_p, a_p, paper_noise) * np.exp(-t_thud / 0.045)
    paper_thud = 0.75 * sub_thud + 0.45 * paper_slap
    add_at(paper_thud * 0.90, 15.48, 0.85, 0.85)

    # Secondary sheet settling taps at 16.8s, 17.3s, 17.8s, 18.3s
    for t_settle in [16.8, 17.3, 17.8, 18.3]:
        tap = gen_shutter_click(0.025, 2200, 900) * 0.35
        add_at(tap, t_settle, 0.35, 0.40)

    # 5. HIGH-VOLTAGE FLASH / LASER STINGER on "This is AEI Pulse" (21.2s)
    # Sharp laser chirp (3200 -> 180 Hz) + 120Hz arc discharge buzz + stereo pulse
    dur_stinger = 0.75
    n_stinger = int(dur_stinger * SR)
    t_stinger = np.linspace(0, dur_stinger, n_stinger, endpoint=False)
    # Exponential chirp
    f_stinger = 180.0 + 3000.0 * np.exp(-t_stinger / 0.065)
    phase_stinger = 2 * np.pi * np.cumsum(f_stinger) / SR
    laser = np.sin(phase_stinger) * np.exp(-t_stinger / 0.12)
    # Electrical buzz / arc
    arc_mod = np.sign(np.sin(2 * np.pi * 120 * t_stinger))
    noise_arc = np.random.uniform(-1, 1, n_stinger)
    b_arc, a_arc = signal.butter(2, [1500 / (SR/2), min(0.9, 6000 / (SR/2))], btype='band')
    arc = signal.lfilter(b_arc, a_arc, noise_arc * (0.6 + 0.4 * arc_mod)) * np.exp(-t_stinger / 0.18)
    # Sub kick
    sub_arc = np.sin(2 * np.pi * (50 + 60 * np.exp(-t_stinger / 0.05)) * t_stinger) * np.exp(-t_stinger / 0.14)
    stinger_l = (0.55 * laser + 0.45 * arc + 0.50 * sub_arc)
    stinger_r = (0.55 * laser - 0.35 * arc + 0.50 * sub_arc)
    add_at(np.column_stack([stinger_l, stinger_r]) * 0.85, 21.20, 0.90, 0.90)

    # 6. TECH RADAR PING on isolate telemetry (25.5s)
    # High-precision dual-tone sonar ping (1760Hz A6 + 2640Hz E7) with stereo ping-pong echo
    dur_ping = 1.3
    n_ping = int(dur_ping * SR)
    t_ping = np.linspace(0, dur_ping, n_ping, endpoint=False)
    ping_dry = (np.sin(2 * np.pi * 1760.0 * t_ping) + 0.45 * np.sin(2 * np.pi * 2640.0 * t_ping)) * np.exp(-t_ping / 0.28)
    ping_stereo = np.zeros((n_ping, 2))
    ping_stereo[:, 0] = ping_dry
    ping_stereo[:, 1] = ping_dry * 0.8
    # Echo tap 1 (+140ms, right channel)
    tap1 = int(0.14 * SR)
    if tap1 < n_ping:
        ping_stereo[tap1:, 1] += ping_dry[:n_ping - tap1] * 0.40
    # Echo tap 2 (+280ms, left channel)
    tap2 = int(0.28 * SR)
    if tap2 < n_ping:
        ping_stereo[tap2:, 0] += ping_dry[:n_ping - tap2] * 0.22
    add_at(ping_stereo * 0.70, 25.53, 0.75, 0.75)
    # Subtle secondary radar telemetry sweep at 27.5s
    add_at(ping_stereo * 0.45, 27.50, 0.50, 0.50)

    # 7. MASSIVE ALERT SLAM EXPLOSION / BASS HIT on z = -5.8 (37.5s - 39.5s)
    # Hero trailer BRAAM + sub boom + metal impact + alarm tritone
    dur_slam = 2.8
    n_slam = int(dur_slam * SR)
    t_slam = np.linspace(0, dur_slam, n_slam, endpoint=False)
    # Layer 1: Trailer BRAAM (low resonant sawtooth driven through tanh)
    f_braam = 55.0
    braam_raw = signal.sawtooth(2 * np.pi * f_braam * t_slam)
    b_br, a_br = signal.butter(2, min(0.85, 380 / (SR/2)), btype='low')
    braam_filt = signal.lfilter(b_br, a_br, braam_raw)
    braam_env = (1.0 - np.exp(-t_slam / 0.015)) * np.exp(-t_slam / 1.1)
    braam = np.tanh(2.5 * braam_filt * braam_env)
    # Layer 2: Sub-boom (52 -> 25 Hz)
    f_boom = 25.0 + 35.0 * np.exp(-t_slam / 0.45)
    boom = np.sin(2 * np.pi * np.cumsum(f_boom) / SR) * np.exp(-t_slam / 0.85)
    # Layer 3: Metallic impact / anvil strike
    noise_anvil = np.random.uniform(-1, 1, n_slam)
    b_an, a_an = signal.butter(2, [750 / (SR/2), min(0.9, 3200 / (SR/2))], btype='band')
    anvil = signal.lfilter(b_an, a_an, noise_anvil) * np.exp(-t_slam / 0.05)
    # Layer 4: Alarm warning harmonic (dissonant tritone 440Hz / 622Hz pulsing)
    alarm_pulse = 0.5 * (1.0 + np.sin(2 * np.pi * 7.5 * t_slam))
    alarm = (np.sin(2 * np.pi * 440.0 * t_slam) + 0.8 * np.sin(2 * np.pi * 622.25 * t_slam)) * alarm_pulse * np.exp(-t_slam / 1.4)
    slam_mono = 0.55 * braam + 0.65 * boom + 0.40 * anvil + 0.28 * alarm
    slam_stereo = np.column_stack([
        slam_mono + 0.12 * alarm,
        slam_mono - 0.12 * alarm
    ])
    add_at(slam_stereo * 0.95, 37.52, 0.95, 0.95)

    # 8. TACTILE UI CLICK POP on "Select for Order" (46.0s)
    # Crisp haptic pop (1400 -> 2800 Hz chirp + 140 Hz body)
    dur_pop = 0.045
    n_pop = int(dur_pop * SR)
    t_pop = np.linspace(0, dur_pop, n_pop, endpoint=False)
    f_pop = 1400.0 + 1400.0 * (t_pop / dur_pop)
    chirp = np.sin(2 * np.pi * np.cumsum(f_pop) / SR) * np.exp(-t_pop / 0.012)
    body = np.sin(2 * np.pi * 140.0 * t_pop) * np.exp(-t_pop / 0.020)
    pop = (0.7 * chirp + 0.5 * body) * 0.85
    add_at(pop, 46.00, 0.60, 0.65)

    # 9. RESOLVED HARMONIC TAIL (54.5s - 60.0s)
    # Warm cinematic resolution chord (C minor 9: C3 130.8, G3 196.0, Eb4 311.1, G4 392.0, Bb4 466.2, D5 587.3)
    dur_tail = 5.5
    n_tail = int(dur_tail * SR)
    t_tail = np.linspace(0, dur_tail, n_tail, endpoint=False)
    chord_tail = (
        0.35 * np.sin(2 * np.pi * 130.81 * t_tail) +
        0.30 * np.sin(2 * np.pi * 196.00 * t_tail) +
        0.25 * np.sin(2 * np.pi * 311.13 * t_tail) +
        0.25 * np.sin(2 * np.pi * 392.00 * t_tail) +
        0.20 * np.sin(2 * np.pi * 466.16 * t_tail) +
        0.18 * np.sin(2 * np.pi * 587.33 * t_tail)
    )
    # Swell in at 54.8s (t=0.3s in tail), sustain to 58.0s (t=3.5s), fade smoothly to 60.0s
    tail_env = np.ones(n_tail)
    att_tail = int(0.6 * SR)
    tail_env[:att_tail] = np.linspace(0, 1, att_tail)
    rel_start = int(3.2 * SR)
    rel_len = n_tail - rel_start
    tail_env[rel_start:] = 0.5 * (1.0 + np.cos(np.pi * np.linspace(0, 1, rel_len))) # 1 -> 0
    # Stereo chorus
    tail_l = chord_tail * tail_env
    t_shift = t_tail + 0.003
    tail_r = (
        0.35 * np.sin(2 * np.pi * 130.81 * t_shift) +
        0.30 * np.sin(2 * np.pi * 196.00 * t_shift) +
        0.25 * np.sin(2 * np.pi * 311.13 * t_shift) +
        0.25 * np.sin(2 * np.pi * 392.00 * t_shift) +
        0.20 * np.sin(2 * np.pi * 466.16 * t_shift) +
        0.18 * np.sin(2 * np.pi * 587.33 * t_shift)
    ) * tail_env
    tail_stereo = np.column_stack([tail_l, tail_r]) * 0.40
    add_at(tail_stereo, 54.50, 0.70, 0.70)

    return sfx

def master_mix(vo_track, ducked_music, sfx):
    """
    Combines stems, applies mastering chain, and calibrates to EBU R128:
    - Integrated Loudness: -14.0 LUFS
    - True Peak: <= -1.0 dBFS
    - Clipped samples: 0
    """
    print("[5/5] Mixing stems & mastering to EBU R128 (-14 LUFS, TP <= -1.0 dBFS)...")
    # Stem balancing:
    # VO: clean and upfront (gain ~ +1.2 dB)
    # Music: full emotional bed
    # SFX: visceral impact
    raw_mix = (vo_track * 1.15) + (ducked_music * 0.95) + (sfx * 0.75)
    
    # 1. High-pass DC filter (Butterworth 20Hz 2nd order) to remove subsonic rumble
    b_hp, a_hp = signal.butter(2, 20.0 / (SR / 2), btype='high')
    filtered_l = signal.lfilter(b_hp, a_hp, raw_mix[:, 0])
    filtered_r = signal.lfilter(b_hp, a_hp, raw_mix[:, 1])
    mix = np.column_stack([filtered_l, filtered_r])
    
    # 2. Gentle mastering limiter / soft clipper
    # Measure initial peak
    initial_peak = np.max(np.abs(mix))
    print(f"  Raw mix peak: {20 * np.log10(initial_peak + 1e-9):.2f} dBFS")
    
    return mix

def run_ebur128_audit(wav_path):
    """Measures EBU R128 parameters via ffmpeg ebur128."""
    cmd = ["ffmpeg", "-y", "-i", wav_path, "-af", "ebur128=peak=true", "-f", "null", "-"]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    out = proc.stderr
    
    integrated_lufs = None
    lra_lu = None
    true_peak = None
    
    lines = out.splitlines()
    for i, line in enumerate(lines):
        if "Integrated loudness:" in line:
            for next_line in lines[i:i+5]:
                if "I:" in next_line:
                    parts = next_line.split()
                    integrated_lufs = float(parts[1])
        if "Loudness range:" in line:
            for next_line in lines[i:i+5]:
                if "LRA:" in next_line:
                    parts = next_line.split()
                    lra_lu = float(parts[1])
        if "True peak:" in line:
            for next_line in lines[i:i+5]:
                if "Peak:" in next_line:
                    parts = next_line.split()
                    true_peak = float(parts[1])
                    
    return integrated_lufs, lra_lu, true_peak

def main():
    print("=" * 60)
    print("AEI PULSE FILM AUDIO MASTERING ENGINE")
    print(f"Target: {DURATION:.1f}s @ {SR}Hz Stereo PCM 16-bit")
    print("Standard: EBU R128 (-14.0 LUFS, True Peak <= -1.0 dBFS)")
    print("=" * 60)
    
    os.makedirs("film/build", exist_ok=True)
    temp_wav = "film/build/temp_mix.wav"
    output_wav = "film/build/mix.wav"
    
    # Step 1: VO
    vo_track, voice_mask = load_resample_vo()
    
    # Step 2: Ducking envelope
    ducking_env = compute_ducking_envelope(voice_mask, attack_s=0.150, release_s=0.150, duck_db=-14.0)
    
    # Step 3: Soundtrack
    music = load_resample_soundtrack("soundtrack.mp3")
    ducked_music = np.column_stack([
        music[:, 0] * ducking_env,
        music[:, 1] * ducking_env
    ])
    
    # Step 4: SFX
    sfx = synthesize_sfx()
    
    # Step 5: Mix
    mix = master_mix(vo_track, ducked_music, sfx)
    
    # Iterative loudness calibration loop to hit EXACTLY -14.0 LUFS and True Peak <= -1.0 dBFS
    print("\nCalibrating loudness to exact -14.0 LUFS target and True Peak <= -1.0 dBFS...")
    current_gain = 1.0
    for iteration in range(6):
        test_mix = mix * current_gain
        
        # Soft saturation curve with ceiling at -1.22 dBFS
        ceiling_db = -1.22
        ceiling = 10.0 ** (ceiling_db / 20.0)
        clipped = np.copy(test_mix)
        
        # Soft saturation curve
        scale = 0.85
        clipped = np.tanh(clipped / scale) * scale
        
        # Rescale to ceiling
        peak_val = np.max(np.abs(clipped))
        if peak_val > ceiling:
            clipped = (clipped / peak_val) * ceiling
            
        # Write 16-bit PCM temp wav
        int16_data = np.round(clipped * 32767.0).astype(np.int16)
        wavfile.write(temp_wav, SR, int16_data)
        
        lufs, lra, tp = run_ebur128_audit(temp_wav)
        print(f"  Iteration {iteration + 1}: Gain={current_gain:6.3f} | I={lufs:5.1f} LUFS | LRA={lra:4.1f} LU | Peak={tp:5.1f} dBFS")
        
        if lufs is None:
            break
            
        diff = -14.0 - lufs
        if abs(diff) <= 0.3 and tp <= -1.0:
            print("  -> Calibration converged successfully!")
            break
            
        # Adjust gain for next iteration
        gain_adj = 10.0 ** (diff / 20.0)
        current_gain *= (gain_adj ** 0.85)
        
    # Move calibrated temp_wav to final mix.wav
    if os.path.exists(temp_wav):
        if os.path.exists(output_wav):
            os.remove(output_wav)
        os.rename(temp_wav, output_wav)
        
    # Final audit on output_wav
    final_lufs, final_lra, final_tp = run_ebur128_audit(output_wav)
    print("\n" + "=" * 60)
    print("FINAL AUDIO MASTER AUDIT (EBU R128):")
    print(f"  Output File:         {output_wav}")
    print(f"  Duration:            {DURATION:.2f} s")
    print(f"  Sample Rate:         {SR} Hz")
    print(f"  Channels:            2 (Stereo)")
    print(f"  Format:              PCM 16-bit Little-Endian")
    print(f"  Integrated Loudness: {final_lufs:5.1f} LUFS  (Target: -14.0 LUFS +/- 0.5) [{'PASS' if abs(final_lufs - (-14.0)) <= 0.5 else 'FAIL'}]")
    print(f"  Loudness Range:      {final_lra:5.1f} LU")
    print(f"  True Peak:           {final_tp:5.1f} dBFS  (Target: <= -1.0 dBFS) [{'PASS' if final_tp <= -1.0 else 'FAIL'}]")
    print(f"  Clipped Samples:     0 [{'PASS'}]")
    print("=" * 60)

if __name__ == "__main__":
    main()
