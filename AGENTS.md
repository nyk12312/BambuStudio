# BambuStudio + PrintFins — agent instructions

Applies to all agent work in this repository.

1. **Git:** `integration` is the approved development baseline; preserve `master`. Never edit either directly. Use isolated feature/fix branches or worktrees; no force-push, merge, release, or discarded work without approval.

2. **Baseline:** Preserve rollback via Git history, tags, and releases. Keep experiments separate from approved integration changes.

3. **Code:** Follow existing conventions. Prefer minimal, focused, maintainable changes over speculative refactoring or dependencies.

4. **Upstream:** Minimize divergence from `bambulab/BambuStudio` and `gittrahan/support-fins`. Keep integration code separate from the pinned, unchanged `resources/printfins/vendor/` snapshot. Preserve source hashes, licenses (AGPL/MIT), attribution, and provenance; review upstream updates separately.

5. **Tests:** Run checks relevant to each change. PrintFins CI uses `python scripts/printfins/check-snapshot.py`, `node --test tests/printfins/*.test.mjs`, and `python -m unittest discover -s tests/printfins -p 'test_*.py' -v`. Report executed, failed, and unavailable checks accurately; never claim an unrun test or build passed.

6. **Native behavior:** For changes to the Bambu UI, slicer, presets, or 3MF, verify relevant behavior with a Windows x64 build/smoke test when feasible. Source tests alone do not prove slicer/printer behavior.

7. **Execution:** Inspect relevant code first, use targeted searches, and reuse verified context. Stay within scope, make small testable changes, and report results and blockers concisely.

8. **Checkpoints:** Commits, pushes, PR publication, releases, and merges require explicit maintainer approval. Before an approved checkpoint, verify branch/base, inspect staged paths, and run `git diff --cached --check`.

9. **Privacy and staging:** Stage explicit files only; never use `git add .` or `git add -A`. Exclude credentials, personal paths, local profiles, logs, build artifacts, and unrelated files. Preserve vendored source integrity and third-party licenses.

10. **Documentation for agents:** Read relevant `README.md` and `docs/` before changing behavior. Keep AI-readable documentation accurate in the same change as new or modified features, architecture, APIs, algorithms, slicer parameters, integration behavior, tests, and known limitations. For PrintFins, explain deviations from upstream and preserve vendor/source provenance. Add focused documentation only where useful; do not create empty templates or duplicate instructions.
