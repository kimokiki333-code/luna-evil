#!/usr/bin/env python3
import argparse, json, os, re, subprocess, sys, time
from pathlib import Path


def emit(stage, progress, message, **extra):
    payload = {"stage": stage, "progress": max(0, min(100, int(progress))), "message": message, **extra}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def srt_time(seconds):
    ms = int(round(max(0.0, seconds) * 1000))
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def ass_time(seconds):
    cs = int(round(max(0.0, seconds) * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def ass_escape(text):
    return text.replace('\\', r'\\').replace('{', r'\\{').replace('}', r'\\}').replace('\n', r'\N')


def get_duration(path):
    p = subprocess.run([
        'ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(path)
    ], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[-1000:] or 'Unable to inspect video')
    return float(p.stdout.strip() or 0)


def ensure_argos_en_ar():
    import argostranslate.package as package
    import argostranslate.translate as translate
    installed = package.get_installed_packages()
    if any(getattr(x, 'from_code', '') == 'en' and getattr(x, 'to_code', '') == 'ar' for x in installed):
        return
    emit('translation-model', 55, 'Preparing the local English → Arabic translation model…')
    package.update_package_index()
    candidates = [x for x in package.get_available_packages() if x.from_code == 'en' and x.to_code == 'ar']
    if not candidates:
        raise RuntimeError('The local English → Arabic translation model is not available from the Argos package index.')
    candidates.sort(key=lambda x: getattr(x, 'package_version', '') or '', reverse=True)
    package.install_from_path(candidates[0].download())
    translate.translate('test', 'en', 'ar')


def translate_text(text):
    import argostranslate.translate as translate
    return translate.translate(text, 'en', 'ar').strip()


def make_ass(items, out_path, width, height, style='social'):
    # Noto Sans Arabic is widely available in the Docker image and handles Arabic shaping.
    font = 'Noto Sans Arabic'
    fontsize = max(34, min(64, round(width / 24)))
    margin_v = max(38, round(height / 14))
    lines = [
        '[Script Info]',
        'ScriptType: v4.00+',
        'PlayResX: 1920',
        'PlayResY: 1080',
        'WrapStyle: 2',
        'ScaledBorderAndShadow: yes',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        f'Style: BadrArabic,{font},{fontsize},&H00FFFFFF,&H00FFFFFF,&H99000000,&H66000000,1,0,0,0,100,100,0,0,1,3,1,2,80,80,{margin_v},1',
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
    ]
    for item in items:
        text = ass_escape(item['text'])
        lines.append(f"Dialogue: 0,{ass_time(item['start'])},{ass_time(item['end'])},BadrArabic,,0,0,0,,{text}")
    Path(out_path).write_text('\n'.join(lines) + '\n', encoding='utf-8')


def burn(video, ass, output):
    # Force a broadly compatible H.264/AAC MP4 so the downloaded result works in common browsers and phones.
    vf = f"subtitles={ass}:fontsdir=/usr/share/fonts/truetype/noto"
    cmd = ['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(video),'-vf',vf,'-c:v','libx264','-preset','veryfast','-crf','22','-c:a','aac','-b:a','128k','-movflags','+faststart',str(output)]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[-2000:] or 'FFmpeg subtitle render failed')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--srt', required=True)
    ap.add_argument('--model', default=os.getenv('WHISPER_MODEL','base'))
    ap.add_argument('--source', default='en')
    ap.add_argument('--target', default='ar')
    args = ap.parse_args()
    inp, out, srt = map(Path, [args.input, args.output, args.srt])
    duration = get_duration(inp)
    emit('extract', 3, 'Opening your video locally…', duration=duration)
    if args.target != 'ar' or args.source != 'en':
        raise RuntimeError('This first release is optimized for English → Arabic.')

    from faster_whisper import WhisperModel
    device = os.getenv('WHISPER_DEVICE','cpu')
    compute = os.getenv('WHISPER_COMPUTE','int8' if device == 'cpu' else 'float16')
    emit('transcribe', 8, f'Listening for English speech with Whisper ({args.model})…')
    model = WhisperModel(args.model, device=device, compute_type=compute)
    segments, info = model.transcribe(str(inp), language='en', beam_size=5, vad_filter=True, word_timestamps=False, condition_on_previous_text=False)
    translated = []
    seen = 0
    for seg in segments:
        text = (seg.text or '').strip()
        if not text:
            continue
        pct = 8 + (min(1.0, seg.end / max(duration, 0.1)) * 42)
        emit('transcribe', pct, f'Transcribing and translating {int(seg.end)}s…')
        ar = translate_text(text)
        if ar:
            translated.append({'start': float(seg.start), 'end': float(seg.end), 'text': ar})
        seen += 1
    if not translated:
        raise RuntimeError('No spoken dialogue was detected in the video.')

    # SRT is useful to the user too, but it is generated automatically and never required as a manual step.
    srt_lines = []
    for i, item in enumerate(translated, 1):
        srt_lines += [str(i), f"{srt_time(item['start'])} --> {srt_time(item['end'])}", item['text'], '']
    srt.write_text('\n'.join(srt_lines), encoding='utf-8-sig')
    emit('render', 58, 'Arabic subtitles are ready. Rendering them directly into the video…', subtitles=len(translated))
    ass = srt.with_suffix('.ass')
    make_ass(translated, ass, 1920, 1080)
    burn(inp, ass, out)
    emit('done', 100, 'Finished — your Arabic-subtitled video is ready.', output=str(out), srt=str(srt))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        emit('error', 100, str(exc))
        sys.exit(1)
