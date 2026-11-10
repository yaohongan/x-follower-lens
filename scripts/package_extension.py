"""Build a reproducible, source-only ZIP for Chromium's Load unpacked flow."""
import argparse
import json
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]


def runtime_files(root):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    files = {"manifest.json", "LICENSE", "PRIVACY.md"}
    files.update(manifest.get("icons", {}).values())
    action = manifest.get("action", {})
    files.update(action.get("default_icon", {}).values())
    popup = action.get("default_popup")
    if popup:
        files.add(popup)
        # The popup's local dependencies are intentionally explicit.
        files.update(("popup.js", "popup.css"))
    for entry in manifest.get("content_scripts", []):
        files.update(entry.get("js", []))
        files.update(entry.get("css", []))
    for name in files:
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError(f"Unsafe extension path: {name}")
        source = root / name
        if not source.resolve().is_relative_to(root.resolve()):
            raise ValueError(f"Extension path escapes source directory: {name}")
        if not source.is_file():
            raise FileNotFoundError(f"Missing extension file: {name}")
    return manifest, sorted(files)


def build(root=ROOT, output=None):
    manifest, files = runtime_files(root)
    output = output or root / "dist" / f"x-follower-lens-{manifest['version']}.zip"
    output = Path(output)
    if output.resolve() in {(root / name).resolve() for name in files}:
        raise ValueError("Output must not overwrite an extension source file")
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name in files:
            # Fixed metadata makes identical source produce identical packages.
            info = ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (root / name).read_bytes())
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="ZIP destination (default: dist/versioned ZIP)")
    args = parser.parse_args()
    print(build(output=args.output))
