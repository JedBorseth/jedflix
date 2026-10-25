"""Exercise the real WARP watchdog with simulated SOCKS/HTTP outcomes."""

import contextlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest


WARP_DIR = Path(__file__).resolve().parents[1] / "deploy" / "warp"
MOCK_CURL = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
if "https://www.cloudflare.com/cdn-cgi/trace" in sys.argv:
    print("warp=on")
    sys.exit(0)
state = Path(os.environ["CURL_STATE"])
data = json.loads(state.read_text())
index = data["calls"]
data["calls"] += 1
state.write_text(json.dumps(data))
code = data["exits"][index] if index < len(data["exits"]) else data["default"]
if os.environ.get("MOCK_HTTP_STATUS", "200") != "200":
    if any(arg.startswith("-") and "f" in arg for arg in sys.argv[1:]):
        code = 22
if "--socks5-hostname" not in sys.argv:
    sys.exit(90)
sys.exit(code)
'''


class WarpProxyTests(unittest.TestCase):
    @contextlib.contextmanager
    def proxy(self, exits=(), default=0, cooldown=False, http_status=200):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("abb-connectivity.sh", "healthcheck.sh", "watchdog.sh"):
                shutil.copy(WARP_DIR / name, root / name)
                (root / name).chmod(0o755)
            (root / "curl").write_text(MOCK_CURL)
            (root / "curl").chmod(0o755)
            state = root / "curl-state.json"
            state.write_text(json.dumps({"calls": 0, "exits": exits, "default": default}))
            recovery = root / "last-recovery"
            if cooldown:
                recovery.write_text(f"{int(time.time())}\n")
            env = {
                **os.environ,
                "PATH": f"{root}:{os.environ['PATH']}",
                "CURL_STATE": str(state),
                "WARP_RECOVERY_FILE": str(recovery),
                "WARP_CHECK_INTERVAL_SECONDS": "0.01",
                "MOCK_HTTP_STATUS": str(http_status),
            }
            target = subprocess.Popen(["sleep", "30"])
            watchdog = subprocess.Popen(
                ["bash", str(root / "watchdog.sh"), str(target.pid)],
                env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            )
            try:
                yield root, env, target, watchdog
            finally:
                for process in (watchdog, target):
                    if process.poll() is None:
                        process.terminate()
                    process.wait(timeout=5)
                watchdog.stderr.close()

    def wait_for_checks(self, root, target, count=6):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if target.poll() is not None:
                self.fail("WARP restarted unexpectedly")
            try:
                calls = json.loads((root / "curl-state.json").read_text())["calls"]
            except json.JSONDecodeError:
                continue
            if calls >= count:
                return
            time.sleep(0.01)
        self.fail("watchdog did not perform enough connectivity checks")

    def test_restarts_stuck_proxy_after_three_failures(self):
        with self.proxy(default=97) as (root, _, target, watchdog):
            watchdog.wait(timeout=5)
            target.wait(timeout=5)
            self.assertEqual(watchdog.returncode, 0)
            self.assertIsNotNone(target.returncode)
            self.assertEqual(json.loads((root / "curl-state.json").read_text())["calls"], 3)
            self.assertTrue((root / "last-recovery").exists())

    def test_success_resets_consecutive_failures(self):
        with self.proxy(exits=[97, 97, 0, 97, 97]) as (root, _, target, _):
            self.wait_for_checks(root, target)

    def test_cooldown_prevents_restart_loop(self):
        with self.proxy(default=97, cooldown=True) as (root, _, target, _):
            self.wait_for_checks(root, target)

    def test_http_rate_limits_and_outages_do_not_restart_proxy(self):
        for status in (403, 429, 503):
            with self.subTest(status=status):
                with self.proxy(http_status=status) as (root, _, target, _):
                    self.wait_for_checks(root, target)

    def test_cloudflare_reachable_but_abb_unreachable_is_unhealthy(self):
        with self.proxy(cooldown=True, default=97) as (root, env, _, _):
            result = subprocess.run(["bash", str(root / "healthcheck.sh")], env=env)
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
