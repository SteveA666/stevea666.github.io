"""Build the self-contained static site for GitHub Pages or local preview."""
import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
from urllib.request import urlopen

WEB = Path(__file__).resolve().parent
VERSION = "1.23.2"
RUNTIME_SHA256 = "0b8707d7efab9a2bea63564d66cad79e897cfd0bd627e5ae000488ffc1c45c7d"
RUNTIME_FILES = (
    "ort.webgpu.min.mjs",
    "ort-wasm-simd-threaded.asyncify.mjs",
    "ort-wasm-simd-threaded.asyncify.wasm",
)


def download(url, destination):
    with urlopen(url, timeout=60) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def install_runtime(destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary) / "onnxruntime-web.tgz"
        download(
            f"https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-{VERSION}.tgz", archive
        )
        with archive.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != RUNTIME_SHA256:
                raise RuntimeError("ONNX Runtime Web package SHA-256 mismatch")
        with tarfile.open(archive) as bundle:
            for filename in RUNTIME_FILES:
                with bundle.extractfile(f"package/dist/{filename}") as source:
                    with (destination / filename).open("wb") as output:
                        shutil.copyfileobj(source, output)
    shutil.copyfile(WEB / "ONNX-RUNTIME-LICENSE", destination / "LICENSE")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, nargs="?", default=Path("dist"))
    args = parser.parse_args()
    target = args.output
    target.mkdir(parents=True, exist_ok=True)
    install_runtime(target / "runtime")
    for filename in ("index.html", "style.css", "app.js", "restore-worker.js", "waterjet.svg", "ImgConversion.svg"):
        shutil.copyfile(WEB / filename, target / filename)
    shutil.copyfile(WEB.parent / "LICENSE", target / "LICENSE")
    shutil.copyfile(WEB.parent / "third_party/fbcnn/LICENSE", target / "FBCNN-LICENSE")
    subprocess.run([sys.executable, str(WEB / "export_models.py"), str(target / "models")], check=True)
    print(f"Static site ready in {target.resolve()}")


if __name__ == "__main__":
    main()
