# PDF viewer tests and CI

Every pull request and push to main runs distinct GitHub Actions checks:

| Check | Coverage |
| --- | --- |
| Quality | JavaScript parse validation for all source, scripts and tests; feature-suite inventory; shell installer syntax |
| Rendering | PDF data sources, enhancement, previews, page rendering, zoom/position, printing and loading |
| Navigation | Page controls, minimap, scrubber, page tabs and printed-page navigation |
| References | Clickable PDF and section references |
| Footnotes | Indexing, scan/column/page continuations, jumps, copy and cross-references |
| Search | Normalization, multiline and URL matching, navigation and visual cues |
| Selection | Text bounds, clipboard fallback, Markdown, tagged paragraphs and punctuation |
| Document | Titles, DOI/date/source metadata and local-file favicon |
| Appearance | Themes and narrow layouts |
| ChatGPT | Summary popup and PDF transfer integration |
| Security | Manifest permissions policy, local-only executable resources, scoped integrations and accessible controls |
| Native host (Linux and macOS) | Python native messaging/installer tests, including concurrency and locking suite |
| Packaging | Build output, PDF worker/assets, bundled stream support, manifest resources and extension artifact |

All *.test.mjs files must be owned by **exactly one** suite, enforced by the runner. Add each new test file explicitly to its corresponding feature in scripts/test-suites.mjs; otherwise quality and feature checks fail rather than silently skipping it.

~~~sh
npm install
npm test                        # run every JavaScript test
npm run check:suites            # show counts and validate suite ownership
npm run test:feature -- search  # run just one feature's tests
npm run check:syntax            # verify JavaScript syntax across project
npm run build && npm run check  # validate unpacked build, manifest and resources
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 tests/native-enhancer.test.py -v
~~~

CI currently tests functions, PDF fixtures, source/packaging contracts and native host subprocesses. It does **not** yet run real Chrome/Brave extension UI end-to-end tests. Manual checks remain necessary for Chrome PDF MIME interception, actual browser rendering, theme color interactions and operating-system permissions.
