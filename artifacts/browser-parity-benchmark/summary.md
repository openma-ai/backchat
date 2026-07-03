# Backchat Browser Parity Benchmark Evidence

Generated: 2026-07-03T13:57:24.315Z

## Summary

- Tasks selected: 5
- Comparisons completed: 8
- Passing comparisons: 8
- Partial comparisons: 0
- Failing comparisons: 0
- Missing pairs: 0

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

## Parity Gaps

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
