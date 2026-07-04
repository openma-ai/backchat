# Backchat Browser Parity Benchmark Evidence

Generated: 2026-07-04T07:26:48.555Z

## Summary

- Tasks selected: 5
- Comparisons completed: 8
- Passing comparisons: 8
- Partial comparisons: 0
- Failing comparisons: 0
- Missing pairs: 0
- Accepted differences: 21
- Unexplained gaps: 0
- Missing required coverage: 8

## Completed Comparisons

### iab-local-fixture

- Task: custom.local-fixture.basic-form
- Surfaces: codex-native-iab vs backchat-iab
- Status: pass
- Left screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-tool-diff/codex-native-iab-screenshot
- Right screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-tool-diff/backchat-iab-screenshot
- Diffs: screenshotBase64Length, stepCount

### chrome-local-fixture

- Task: custom.local-fixture.basic-form
- Surfaces: codex-native-chrome vs backchat-chrome
- Status: pass
- Left screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-tool-diff/codex-native-chrome-screenshot
- Right screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-tool-diff/backchat-chrome-screenshot
- Diffs: screenshotBase64Length, stepCount

### iab-miniwob-click-button

- Task: miniwob.click-button
- Surfaces: codex-native-iab vs backchat-iab
- Status: pass
- Left screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-miniwob-diff/codex-native-iab-click-button-screenshot.jpg
- Right screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-miniwob-diff/backchat-iab-click-button-screenshot.jpg
- Diffs: wobReward, screenshotBase64Length, stepCount

### chrome-miniwob-click-button

- Task: miniwob.click-button
- Surfaces: codex-native-chrome vs backchat-chrome
- Status: pass
- Left screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-miniwob-diff/codex-native-chrome-click-button-screenshot.jpg
- Right screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-miniwob-diff/backchat-chrome-click-button-screenshot.jpg
- Diffs: wobReward, screenshotBase64Length

### iab-miniwob-enter-text

- Task: miniwob.enter-text
- Surfaces: codex-native-iab vs backchat-iab
- Status: pass
- Left screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-miniwob-diff/codex-native-iab-enter-text-screenshot.jpg
- Right screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-miniwob-diff/backchat-iab-enter-text-screenshot.jpg
- Diffs: wobReward, screenshotBase64Length

### chrome-miniwob-enter-text

- Task: miniwob.enter-text
- Surfaces: codex-native-chrome vs backchat-chrome
- Status: pass
- Left screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-miniwob-diff/codex-native-chrome-enter-text-screenshot.jpg
- Right screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-miniwob-diff/backchat-chrome-enter-text-screenshot.jpg
- Diffs: wobReward, screenshotBase64Length, stepCount

### iab-wikipedia-selenium

- Task: webvoyager.wikipedia.selenium-search
- Surfaces: codex-native-iab vs backchat-iab
- Status: pass
- Left screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-real-site-diff/codex-native-iab-wikipedia-screenshot
- Right screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-real-site-diff/backchat-iab-wikipedia-screenshot
- Diffs: linkCount, screenshotHeight, screenshotBase64Length, stepCount

### chrome-wikipedia-selenium

- Task: webvoyager.wikipedia.selenium-search
- Surfaces: codex-native-chrome vs backchat-chrome
- Status: pass
- Left screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-real-site-diff/codex-native-chrome-wikipedia-screenshot
- Right screenshot: /Users/xiaoyang/Proj/backchat/artifacts/browser-real-site-diff/backchat-chrome-wikipedia-screenshot
- Diffs: linkCount, screenshotHeight, screenshotBase64Length

## Raw Diffs

- iab-local-fixture / screenshotBase64Length: 21500 vs 22516
- iab-local-fixture / stepCount: 12 vs 13
- chrome-local-fixture / screenshotBase64Length: 31364 vs 33412
- chrome-local-fixture / stepCount: 12 vs 15
- iab-miniwob-click-button / wobReward: 0.8341000000000001 vs 1
- iab-miniwob-click-button / screenshotBase64Length: 13272 vs 15060
- iab-miniwob-click-button / stepCount: 11 vs 12
- chrome-miniwob-click-button / wobReward: 0.9436 vs 0.9965
- chrome-miniwob-click-button / screenshotBase64Length: 20392 vs 22272
- iab-miniwob-enter-text / wobReward: 0.7114 vs 0.9991
- iab-miniwob-enter-text / screenshotBase64Length: 13180 vs 15060
- chrome-miniwob-enter-text / wobReward: 0.905 vs 0.9908
- chrome-miniwob-enter-text / screenshotBase64Length: 19836 vs 21896
- chrome-miniwob-enter-text / stepCount: 12 vs 11
- iab-wikipedia-selenium / linkCount: 310 vs 335
- iab-wikipedia-selenium / screenshotHeight: 7360 vs 7747
- iab-wikipedia-selenium / screenshotBase64Length: 1422384 vs 1876116
- iab-wikipedia-selenium / stepCount: 11 vs 10
- chrome-wikipedia-selenium / linkCount: 317 vs 332
- chrome-wikipedia-selenium / screenshotHeight: 6304 vs 6865
- chrome-wikipedia-selenium / screenshotBase64Length: 1649332 vs 2051076

## Gap Audit

### Accepted differences

- iab-local-fixture / screenshotBase64Length: encoded-visual; Encoded screenshot byte size is not a semantic parity field when MIME and geometry match.
- iab-local-fixture / stepCount: harness-implementation; Harness step count records implementation trace granularity, not user-visible browser behavior.
- chrome-local-fixture / screenshotBase64Length: encoded-visual; Encoded screenshot byte size is not a semantic parity field when MIME and geometry match.
- chrome-local-fixture / stepCount: harness-implementation; Harness step count records implementation trace granularity, not user-visible browser behavior.
- iab-miniwob-click-button / wobReward: timing-reward; MiniWoB shaped reward includes time scaling; done/raw reward remain the parity fields.
- iab-miniwob-click-button / screenshotBase64Length: encoded-visual; Encoded screenshot byte size is not a semantic parity field when MIME and geometry match.
- iab-miniwob-click-button / stepCount: harness-implementation; Harness step count records implementation trace granularity, not user-visible browser behavior.
- chrome-miniwob-click-button / wobReward: timing-reward; MiniWoB shaped reward includes time scaling; done/raw reward remain the parity fields.
- chrome-miniwob-click-button / screenshotBase64Length: encoded-visual; Encoded screenshot byte size is not a semantic parity field when MIME and geometry match.
- iab-miniwob-enter-text / wobReward: timing-reward; MiniWoB shaped reward includes time scaling; done/raw reward remain the parity fields.
- iab-miniwob-enter-text / screenshotBase64Length: encoded-visual; Encoded screenshot byte size is not a semantic parity field when MIME and geometry match.
- chrome-miniwob-enter-text / wobReward: timing-reward; MiniWoB shaped reward includes time scaling; done/raw reward remain the parity fields.
- chrome-miniwob-enter-text / screenshotBase64Length: encoded-visual; Encoded screenshot byte size is not a semantic parity field when MIME and geometry match.
- chrome-miniwob-enter-text / stepCount: harness-implementation; Harness step count records implementation trace granularity, not user-visible browser behavior.
- iab-wikipedia-selenium / linkCount: dynamic-content; Public real-site link inventory can drift while final URL, title, heading, and target text match.
- iab-wikipedia-selenium / screenshotHeight: dynamic-visual; Public real-site full-page height can drift with banners, references, and responsive content.
- iab-wikipedia-selenium / screenshotBase64Length: encoded-visual; Encoded screenshot byte size is not a semantic parity field when MIME and geometry match.
- iab-wikipedia-selenium / stepCount: harness-implementation; Harness step count records implementation trace granularity, not user-visible browser behavior.
- chrome-wikipedia-selenium / linkCount: dynamic-content; Public real-site link inventory can drift while final URL, title, heading, and target text match.
- chrome-wikipedia-selenium / screenshotHeight: dynamic-visual; Public real-site full-page height can drift with banners, references, and responsive content.
- chrome-wikipedia-selenium / screenshotBase64Length: encoded-visual; Encoded screenshot byte size is not a semantic parity field when MIME and geometry match.

### Unexplained gaps

- none

### Missing required coverage

- auth
- clipboard
- dialogs
- error-recovery
- iframe
- installation
- shadow-dom
- upload-download

## Supplemental Evidence Sources

- chrome-extension-static-ux: verified; coverage=extension-ux, permissions
  Covers popup/status/paused/port diagnostics, required permission display, and Backchat Settings status model.
- browser-gui-visual-evidence: verified; coverage=visual-regression
  Local screenshot manifest records IAB and Chrome extension GUI evidence; screenshots stay outside the small committed evidence pack.
- extension-installation-distribution: missing; coverage=installation
  Unpacked load-path guidance exists, but native messaging or an equivalent packaged distribution flow is not implemented yet.

## Selected Task Sources

- custom.local-fixture.basic-form: custom-smoke; coverage=input, locator, dom-snapshot, screenshot, tab-lifecycle, viewport
- miniwob.click-button: miniwob++; coverage=input, locator, screenshot, tab-lifecycle, viewport
- miniwob.enter-text: miniwob++; coverage=input, locator, dom-snapshot, tab-lifecycle, viewport
- webvoyager.wikipedia.selenium-search: webvoyager; coverage=navigation, input, locator, dom-snapshot, screenshot, tab-lifecycle, real-site-dynamic-content
- online-mind2web.wikipedia.article-search: online-mind2web; coverage=navigation, input, locator, dom-snapshot, screenshot, real-site-dynamic-content

## Benchmark References

- miniwobPlusPlus: https://github.com/Farama-Foundation/miniwob-plusplus
- webVoyager: https://github.com/MinorJerry/WebVoyager
- onlineMind2Web: https://github.com/OSU-NLP-Group/Online-Mind2Web
- browserGym: https://github.com/ServiceNow/BrowserGym
