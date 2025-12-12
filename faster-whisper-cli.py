#!/usr/bin/env python3
"""
faster-whisper CLI wrapper for Social Archiver

This script provides a command-line interface to the faster-whisper library,
compatible with the expected interface used by the Obsidian plugin.

Installation:
  1. pip install faster-whisper
  2. Save this script as 'faster-whisper' in your PATH (e.g., ~/.local/bin/)
  3. chmod +x ~/.local/bin/faster-whisper

Usage:
  faster-whisper --version
  faster-whisper audio.mp3 --model medium --output_format json --output_dir /tmp
"""

import argparse
import json
import os
import sys


def get_version():
    try:
        import faster_whisper
        return f"faster-whisper {faster_whisper.__version__}"
    except ImportError:
        return "faster-whisper (version unknown)"


def transcribe(audio_path, model_size="medium", language=None, word_timestamps=False, output_format="json", output_dir=None, device="auto", compute_type="int8"):
    """Transcribe audio using faster-whisper"""
    from faster_whisper import WhisperModel

    # Determine device
    actual_device = device
    actual_compute_type = compute_type

    if device == "auto":
        actual_device = "cpu"
        actual_compute_type = "int8"
        try:
            import torch
            if torch.cuda.is_available():
                actual_device = "cuda"
                actual_compute_type = "float16" if compute_type == "auto" else compute_type
        except ImportError:
            pass

    print(f"Loading {model_size} model on {actual_device} (compute_type: {actual_compute_type})...", file=sys.stderr)
    model = WhisperModel(model_size, device=actual_device, compute_type=actual_compute_type)

    # Transcribe
    print(f"Transcribing: {audio_path}", file=sys.stderr)

    transcribe_options = {
        "beam_size": 5,
        "word_timestamps": word_timestamps,
    }

    if language and language != "auto":
        transcribe_options["language"] = language

    segments, info = model.transcribe(audio_path, **transcribe_options)

    # Get duration for progress calculation
    total_duration = info.duration
    print(f"Audio duration: {total_duration:.1f}s", file=sys.stderr)

    # Collect results
    result_segments = []
    full_text = []
    last_progress = -1

    for segment in segments:
        # Output progress (percentage based on segment end time)
        # Format: "progress = XX%" to match TranscriptionService parser
        if total_duration > 0:
            progress = min(100, int((segment.end / total_duration) * 100))
            if progress > last_progress:
                print(f"progress = {progress}%", file=sys.stderr)
                last_progress = progress

        seg_data = {
            "id": segment.id,
            "seek": segment.seek,
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
            "avg_logprob": segment.avg_logprob,
            "no_speech_prob": segment.no_speech_prob,
            "compression_ratio": segment.compression_ratio,
        }

        if word_timestamps and segment.words:
            seg_data["words"] = [
                {
                    "word": word.word,
                    "start": word.start,
                    "end": word.end,
                    "probability": word.probability,
                }
                for word in segment.words
            ]

        result_segments.append(seg_data)
        full_text.append(segment.text.strip())

    result = {
        "text": " ".join(full_text),
        "segments": result_segments,
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "duration_after_vad": getattr(info, 'duration_after_vad', info.duration),
    }

    # Output handling
    if output_format == "json":
        output_content = json.dumps(result, ensure_ascii=False, indent=2)
    elif output_format == "txt":
        output_content = result["text"]
    elif output_format == "srt":
        output_content = segments_to_srt(result_segments)
    elif output_format == "vtt":
        output_content = segments_to_vtt(result_segments)
    else:
        output_content = json.dumps(result, ensure_ascii=False, indent=2)

    # Write to file or stdout
    if output_dir:
        base_name = os.path.splitext(os.path.basename(audio_path))[0]
        ext = {"json": "json", "txt": "txt", "srt": "srt", "vtt": "vtt"}.get(output_format, "json")
        output_path = os.path.join(output_dir, f"{base_name}.{ext}")
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(output_content)
        print(f"Output written to: {output_path}", file=sys.stderr)
    else:
        print(output_content)

    return result


def segments_to_srt(segments):
    """Convert segments to SRT format"""
    lines = []
    for i, seg in enumerate(segments, 1):
        start = format_timestamp_srt(seg["start"])
        end = format_timestamp_srt(seg["end"])
        lines.append(f"{i}")
        lines.append(f"{start} --> {end}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)


def segments_to_vtt(segments):
    """Convert segments to WebVTT format"""
    lines = ["WEBVTT", ""]
    for seg in segments:
        start = format_timestamp_vtt(seg["start"])
        end = format_timestamp_vtt(seg["end"])
        lines.append(f"{start} --> {end}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)


def format_timestamp_srt(seconds):
    """Format seconds as SRT timestamp (HH:MM:SS,mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def format_timestamp_vtt(seconds):
    """Format seconds as VTT timestamp (HH:MM:SS.mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe audio using faster-whisper",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument("--version", action="store_true", help="Show version and exit")
    parser.add_argument("audio", nargs="?", help="Path to audio file")
    parser.add_argument("--model", "-m", default="medium",
                       choices=["tiny", "base", "small", "medium", "large", "large-v2", "large-v3"],
                       help="Model size (default: medium)")
    parser.add_argument("--language", "-l", default=None,
                       help="Language code (e.g., en, ja, ko) or 'auto' for auto-detection")
    parser.add_argument("--word_timestamps", "-w", action="store_true",
                       help="Enable word-level timestamps")
    parser.add_argument("--output_format", "-f", default="json",
                       choices=["json", "txt", "srt", "vtt"],
                       help="Output format (default: json)")
    parser.add_argument("--output_dir", "-o", default=None,
                       help="Output directory for transcription file")
    parser.add_argument("--device", "-d", default="auto",
                       choices=["auto", "cpu", "cuda"],
                       help="Device to use (default: auto)")
    parser.add_argument("--compute_type", "-c", default="int8",
                       choices=["int8", "float16", "float32"],
                       help="Compute type (default: int8 for lower memory)")

    args = parser.parse_args()

    if args.version:
        print(get_version())
        return 0

    if not args.audio:
        parser.print_help()
        return 1

    if not os.path.exists(args.audio):
        print(f"Error: Audio file not found: {args.audio}", file=sys.stderr)
        return 1

    try:
        transcribe(
            args.audio,
            model_size=args.model,
            language=args.language,
            word_timestamps=args.word_timestamps,
            output_format=args.output_format,
            output_dir=args.output_dir,
            device=args.device,
            compute_type=args.compute_type,
        )
        return 0
    except Exception as e:
        error_msg = str(e).lower()
        if "memory" in error_msg or "oom" in error_msg or "cuda out of memory" in error_msg:
            print(f"Error: Out of memory. Try a smaller model or use --compute_type int8", file=sys.stderr)
        else:
            print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
