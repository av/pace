#!/usr/bin/env python3
"""Take screenshots of every example dashboard config in this directory."""

import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

PORT = 17453
DIR = Path(__file__).parent
PROJECT = DIR.parent


def wait_for_server(port, timeout=30):
    start = time.time()
    while time.time() - start < timeout:
        try:
            urllib.request.urlopen(f"http://localhost:{port}/health", timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def take_screenshot(config_path, out_path):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "data").mkdir()
        # pace expects to find config.yaml in its cwd
        config_in_tmp = tmp / "config.yaml"
        config_in_tmp.write_text(config_path.read_text())

        server = subprocess.Popen(
            ["bun", "run", "src/cli.ts", "serve", "--chdir", str(tmp), "--port", str(PORT)],
            cwd=str(PROJECT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        try:
            if not wait_for_server(PORT):
                stderr = server.stderr.read().decode("utf-8", errors="replace").strip()
                print(f"  Server failed to start:\n{stderr}")
                return False

            print("  Server up; waiting for initial data fetch...")
            time.sleep(15)

            with sync_playwright() as p:
                browser = p.chromium.launch()
                page = browser.new_page(viewport={"width": 1920, "height": 1080})
                page.goto(f"http://localhost:{PORT}", wait_until="networkidle")
                # Force lazy images and iframes to load before screenshot
                page.evaluate("() => { document.querySelectorAll('img, iframe').forEach(el => el.loading = 'eager'); }")
                page.wait_for_timeout(3000)
                page.screenshot(path=str(out_path), full_page=True)
                browser.close()

            print(f"  Screenshot saved: {out_path}")
            return True

        except Exception as e:
            print(f"  Failed: {e}")
            return False

        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
            time.sleep(1)


def main():
    configs = sorted(DIR.glob("*.yaml"))
    print(f"Found {len(configs)} example config(s) in {DIR}")

    for cfg in configs:
        name = cfg.stem
        out = DIR / f"{name}.png"
        print(f"\n--- {name} ---")
        take_screenshot(cfg, out)

    print("\nDone!")


if __name__ == "__main__":
    main()
