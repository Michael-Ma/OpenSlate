"""Six short speech calls, durable intent/usage ledger, no SDK or manual retries."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import wave

PRICE = {"input": 0.60 / 1_000_000, "output": 12 / 1_000_000}
RESERVE = 0.015
LIMIT = 0.10


def main():
    manifest_path = Path(sys.argv[1]).resolve()
    manifest = json.loads(manifest_path.read_text())
    jobs = manifest["narration"]
    if not 1 <= len(jobs) <= 6:
        raise ValueError("One to six narration stages only")
    ids = [job["id"] for job in jobs]
    if len(set(ids)) != len(ids) or any(not id.isascii() or not id.replace("-", "").isalnum() for id in ids):
        raise ValueError("Unique simple stage IDs required")
    if any(not 0 < len(job["text"]) <= 450 for job in jobs):
        raise ValueError("Each stage must have 1-450 characters")
    folder = manifest_path.parent / "narration"
    folder.mkdir(exist_ok=True)
    ledger_path = folder / "ledger.json"

    def save():
        temp = ledger_path.with_suffix(".tmp")
        temp.write_text(json.dumps(ledger, indent=2))
        temp.replace(ledger_path)

    # A lock also prevents simultaneous invocations from both passing the budget check.
    lock = folder / "narration.lock"
    with lock.open("x"):
        pass
    try:
        # Read only after acquiring the lock: a competing process may have just
        # completed and released it while this invocation was starting.
        ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else []
        from openai import OpenAI
        client = OpenAI(max_retries=0, timeout=120)
        for job in jobs:
            digest = hashlib.sha256(job["text"].encode()).hexdigest()
            previous = next((row for row in ledger if row["id"] == job["id"]), None)
            if previous:
                if previous["state"] != "done" or previous["sha256"] != digest:
                    raise ValueError("Prior request needs reconciliation; never automatically resubmit")
                continue
            if sum(row.get("costUsd", RESERVE) for row in ledger) + RESERVE > LIMIT:
                raise ValueError("Narration would exceed its $0.10 reserve")
            row = {"id": job["id"], "sha256": digest, "state": "unknown", "reservedUsd": RESERVE}
            ledger.append(row)
            save()  # Persist intent before making the paid call.
            pcm = bytearray()
            usage = None
            with client.audio.speech.with_streaming_response.create(
                model="gpt-4o-mini-tts", voice="cedar", input=job["text"],
                instructions="Tone: Warm and conversational. Pacing: Clear, steady product demonstration. Delivery: Natural, without an announcer voice.",
                response_format="pcm", stream_format="sse",
            ) as response:
                row["requestId"] = response.headers.get("x-request-id")
                save()
                for line in response.iter_lines():
                    if not line.startswith("data: ") or line == "data: [DONE]":
                        continue
                    event = json.loads(line[6:])
                    if event["type"] == "speech.audio.delta":
                        pcm.extend(base64.b64decode(event["audio"], validate=True))
                    elif event["type"] == "speech.audio.done":
                        usage = event["usage"]
            if not usage or not pcm:
                raise ValueError("Incomplete speech response; request remains unknown")
            output = folder / f"{job['id']}.wav"
            with wave.open(str(output), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(24000)
                audio.writeframes(pcm)
            row.update(state="done", usage=usage, durationSeconds=len(pcm) / 48000,
                       costUsd=usage["input_tokens"] * PRICE["input"] + usage["output_tokens"] * PRICE["output"],
                       file=str(output))
            save()
            print(json.dumps(row), flush=True)
            if sum(item.get("costUsd", RESERVE) for item in ledger) > LIMIT:
                raise ValueError("Narration limit reached; stop spending")
    finally:
        lock.unlink()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Do not dump HTTP responses, headers, environment, or authentication errors.
        print(f"Narration stopped: {type(error).__name__}. Check the local ledger before any further call.", file=sys.stderr)
        sys.exit(1)
