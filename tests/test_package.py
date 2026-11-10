"""Run with: python3 -m unittest discover -s tests -p 'test_*.py'."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("package_extension", ROOT / "scripts/package_extension.py")
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class PackageTests(unittest.TestCase):
    def test_package_matches_source_and_excludes_development_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = package.build(output=Path(tmp) / "extension.zip")
            with ZipFile(output) as archive:
                self.assertIsNone(archive.testzip())
                manifest, files = package.runtime_files(ROOT)
                self.assertEqual(archive.namelist(), files)
                self.assertEqual(json.loads(archive.read("manifest.json")), manifest)
                for name in files:
                    self.assertEqual(archive.read(name), (ROOT / name).read_bytes())
                self.assertTrue(all(not name.startswith(("tests/", "store/", ".git/", "dist/")) for name in files))
                self.assertIn("popup.js", files)
                self.assertIn("popup.css", files)
                self.assertIn("icons/icon128.png", files)

    def test_reproducible(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = package.build(output=Path(tmp) / "a.zip")
            b = package.build(output=Path(tmp) / "b.zip")
            self.assertEqual(a.read_bytes(), b.read_bytes())

    def test_missing_asset_fails_before_creating_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copy(ROOT / "manifest.json", root)
            with self.assertRaises(FileNotFoundError):
                package.build(root=root)
            self.assertFalse((root / "dist").exists())

    def test_unsafe_manifest_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = json.loads((ROOT / "manifest.json").read_text())
            manifest["icons"]["16"] = "../outside.png"
            (root / "manifest.json").write_text(json.dumps(manifest))
            # Supply all safe files so validation cannot fail before the unsafe path.
            _, files = package.runtime_files(ROOT)
            for name in files:
                if name == "manifest.json":
                    continue
                (root / name).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(ROOT / name, root / name)
            with self.assertRaises(ValueError):
                package.build(root=root)

    def test_output_cannot_overwrite_source(self):
        with self.assertRaises(ValueError):
            package.build(output=ROOT / "manifest.json")


if __name__ == "__main__":
    unittest.main()
