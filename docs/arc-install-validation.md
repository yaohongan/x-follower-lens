# Arc source-install validation

## Environment

- Date: 2026-11-10
- macOS, Arc 1.172.1
- Extension: 0.23.0, loaded from the repository root using Load unpacked

## Observed Results

- Arc reported that the extension loaded successfully.
- The native Extensions menu opened the settings popup with version 0.23.0.
- A new, authenticated X profile tab displayed follower badges, quality/content
  labels, tweet flow badges, avatar flow indicators, and profile action buttons.
- Enabling the debug setting immediately displayed packet, user, and decorated
  item counts without refreshing the page. The debug setting was restored to off.
- Reopening the popup showed locally persisted account history.
- Navigating to Following displayed account badges and the analysis toolbar;
  its count advanced to 50 loaded accounts. Automatic following-list scrolling
  remained at its default off setting.
- No posts, replies, follows, unfollows, likes, or other social actions were sent.

## Automated Checks

- `python3 -m unittest discover -s tests -p 'test_*.py'`: five tests passed.
- `node tests/check_syntax.js`: all five runtime scripts compiled.
- `python3 scripts/package_extension.py`: produced a current-version ZIP with
  15 files, a root-level manifest, and no development/store/Git files.
- ZIP tests verify byte-for-byte runtime/source equality, reproducibility,
  missing-file rejection, unsafe-path rejection, and source-overwrite prevention.

## Scope and Limitations

The existing runtime worked in Arc without a browser-specific code change or
additional permission. This change supplies an alternate source-install and
packaging workflow; it does not establish why a Chrome Web Store installation
failed or claim to repair the store. No store listing URL or original store
error was available for reproducing that failure.

The installed extension was loaded from source, not from an extracted generated
ZIP; the package tests verify identical runtime bytes. X Pro, Twitter redirects,
all export/card features, and the existing Playwright E2E suites were not tested
in this validation. Other X extensions were left enabled, so duplicate badges
from different extensions can still appear.
