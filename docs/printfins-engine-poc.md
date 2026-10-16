# PrintFins engine PoC

This opt-in Windows experiment connects an actual Bambu Studio model to the
user-modified PrintFins JavaScript engine. It does not replace Bambu support
generation, add a production UI, change presets, or send anything to a printer.

## Source and scope

The source was identified at
`C:\path\to\support-fins-main`.
It is an unpacked, modified project without local Git metadata. The imported
dependency closure is 44 unchanged files (557,106 bytes), including LICENSE.
`resources/printfins/vendor/ORIGIN.json` identifies the snapshot by SHA256.

Compared with public `gittrahan/support-fins` commit
`684ab98cfbdb0866fe670cd45dd88cdf09ad95f5`, 49 non-vendor web JavaScript files
differ. This is a comparison with current upstream, not proof that every
difference was authored locally: the original archive's base commit is unknown.
In particular, upstream has no `prop/starts.js` or `prop/lower.js`; the local
`mold.js` integrates start certification and layer-aligned lower contacts,
`sweep.js` preserves lower clearance on short walls, and `fins.js` accepts
`propFootGap` / `propLowerLayers`. The original project is only read.

## Data flow

1. Explicit `BBS_PRINTFINS_POC_ENABLE=1` and `BBS_PRINTFINS_POC_OUTPUT` opt-in
   after GUI startup. Ordinary startup returns immediately. The output must be a
   new `result` directory beside the active `profile` directory. Exactly one
   object and one instance are required.
2. C++ expands indexed model meshes to double-precision triangle positions in
   millimetres, Z up: `instance matrix * volume matrix * vertex`. Mirrored
   transformations reverse winding. Modifiers and previous PoC fins are refused.
3. JSON `{positions, options}` is passed to local WebView2. Its module worker
   invokes `computeFins()`. No Node, Python or new runtime is needed in the app.
4. The engine returns float32 fin/pad triangle positions, seating offset, piece
   ranges and statistics. C++ applies `inverse(instance) * (position - offset)`.
5. Piece ranges become individual `TriangleMesh` / `MODEL_PART` volumes via
   `ModelObject::add_volume(..., false)`, with one undo snapshot. Original model
   meshes are retained. The object list, scene and background slicing are updated.
6. The PoC exports `request.json`, geometry-only `result.3mf`, native Bambu
   `project.3mf`, `combined.stl`, and `report.json` into a new directory. The native
   project uses the existing `Plater::export_3mf()` and retains the separate parts.
   It also checks the fin geometry separately
   using Bambu's `slice_mesh()` and records movement caused by `ensure_on_bed()`.

## Build and run

Build the existing Release x64 configuration using the installed VS toolchain:

```powershell
cmake --build build --config Release --target BambuStudio_app_gui -- /m:2
```

Run from a VS 2026 x64 Developer shell with the existing CMake/Perl/pkg-config
environment. No dependency installation is part of this experiment.

Prepare a NEW test directory. This copies only public system presets and a
whitelisted configuration subset from a working profile, omitting accounts,
printer connections, plugins, recent projects and user presets. It creates a
closed, tilted-box STL; it does not edit the template profile.

```powershell
python scripts/printfins/prepare-run.py build/printfins-poc-run01 --profile-template C:\3D-Dev\BambuStudio-TestProfile
powershell -File scripts/printfins/run-poc.ps1 -RunDirectory build/printfins-poc-run01
```

On systems whose PowerShell policy disables `.ps1` files, use direct commands
instead; no execution-policy change is needed:

```powershell
$run = (Resolve-Path build/printfins-poc-run01).Path
$env:BBS_PRINTFINS_POC_ENABLE = '1'
$env:BBS_PRINTFINS_POC_OUTPUT = Join-Path $run 'result'
$env:BBS_PRINTFINS_POC_ASSETS = (Resolve-Path resources/printfins).Path
$env:BBS_PRINTFINS_POC_OPTIONS = Join-Path $run 'options.json'
$env:BBS_PRINTFINS_POC_AUTOCLOSE = '1'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $run 'webview-profile'
Start-Process (Resolve-Path build/src/Release/bambu-studio.exe).Path -WorkingDirectory $run -ArgumentList ('--datadir "{0}\profile" "{0}\input.stl"' -f $run)
Remove-Item Env:BBS_PRINTFINS_POC_ENABLE, Env:BBS_PRINTFINS_POC_OUTPUT, Env:BBS_PRINTFINS_POC_ASSETS, Env:BBS_PRINTFINS_POC_OPTIONS, Env:BBS_PRINTFINS_POC_AUTOCLOSE, Env:WEBVIEW2_USER_DATA_FOLDER
```

Use a new directory name for every run. To try another simple mesh, replace only
the newly generated `input.stl` before launching. The application remains open
after its PoC dialog closes so the resulting model can be inspected.

`options.json` can set `lowerFootGap` (0..0.4 mm), `alignLowerLayers`, `tines`,
`bedPad`, `coverage`, `mode`, `nozzle` and `bodyThickness`. Effective object/preset
layer heights override JSON values; presets are never rewritten by the adapter.
Different regular/first-layer heights require `alignLowerLayers: true`: the older
plugin entry otherwise omits the first-layer height needed by start certification.
The launch script also isolates the WebView2 runtime profile in the run directory.
The older plugin entry uses its PLA upper-gap/pad defaults. The interface-material
mode is disabled; full web-application feature parity is not claimed.

For a visible review of the already exported native project with generation
disabled, follow [the isolated manual GUI test](printfins-manual-gui-test.md).

## Tests

```powershell
node --test tests/printfins/adapter.test.mjs
python scripts/printfins/check-snapshot.py "PATH\TO\ORIGINAL\support-fins-main"
python scripts/printfins/check-result.py build/printfins-poc-run01/result
node scripts/printfins/run-original-tests.mjs "PATH\TO\ORIGINAL\support-fins-main"
node scripts/printfins/run-original-tests.mjs "PATH\TO\ORIGINAL\support-fins-main" lower_gap_stability.test.js
```

The last commands read the original tests and fixtures without copying private
model fixtures into this public repository. The small compatibility runner maps
the used Deno test/read APIs and browser Worker API to installed Node. These are
not executions of the Deno runtime.

## Limitations

- Windows/WebView2 only; no new menu, interactive placement or automatic updates.
- One object/instance, no modifiers or variable layer-height profile; 100,000
  input triangles. The JSON transport is deliberately bounded, not optimized for
  production-sized meshes. Multi-material and multi-instance behavior is untested.
  Mirroring/nonuniform scaling are handled in the transformation code but have
  not been exercised in the native end-to-end fixture.
- The worker is interruptible by destroying the view; a 120-second timeout reports
  failure. UI changes are blocked by the modal PoC dialog while it computes.
- Fin identities/settings are not yet persisted as editable engine features.
  Exported 3MF retains baked model parts, not a regeneratable PrintFins session.
- Native `slice_mesh()` verifies contours, not full G-code toolpaths or physical
  print quality. A separate CLI slice is needed to establish toolpath generation.
- No physical print or H2D communication is performed.
- This adapter uses PLA upper-gap/pad defaults even when the isolated Bambu test
  profile selects PETG. It is a geometry-integration experiment, not a validated
  material configuration or a recommendation to print the generated G-code.

## Validation results (2026-10-16)

The interrupted build had no recorded compiler error and no completed link. Its
log was preserved. The resumed Release x64 build finished with exit 0 in 578.6 s;
the subsequent incremental addition of native project export took 46.06 s,
also exit 0. Existing compiler warnings and linker warning LNK4098 were retained.
No parallel builds or dependency installations were used.

| Check | Actual result |
|---|---|
| Adapter tests | 4 passed, including positioning, piece ranges, lower-gap propagation/reset and invalid input |
| Original local regression tests | 25 passed for lower gap, 45-degree starts and layer contacts; 3 additional stability tests passed |
| Snapshot verification | All 44 copied files match both their manifest and the original folder |
| Native GUI/WebView2 run | Passed, final executable; `build/printfins-poc-run04/result/report.json` |
| Separate model parts | Original part + one tined fin + pad; native project metadata records all 3 as `normal_part` |
| Geometry | 12 original triangles retained; 440 fin triangles, 42,668 pad triangles; 4 tines, no reported unserved region |
| Position check against input and Node replay | Maximum vertex error 0.0000010338 mm; instance transform delta 0 |
| Native contour slicing | 209 nonempty combined slices; added geometry has contours on 85 slice planes |
| Full native-project CLI slice | Exit 0 in 0.80 s; 43,120 triangles, 0.16 mm layers, no reported warning; 985,512-byte G-code |
| Full STL CLI slice (earlier run) | Exit 0 at matching 0.16/0.20 mm regular/first-layer heights |

Final review artifacts:

- `build/printfins-poc-run04/result/project.3mf`: native Bambu project, separate parts
- `build/printfins-poc-run04/result/placement-check.json`: independent position check
- `build/printfins-poc-run04/cli-native-python/plate_1.gcode`: offline slice result
- `build/printfins-poc-run04/cli-native-python/result.json`: slicer's own result
- `build/printfins-poc-run04/cli-native-python-process.json`: independently recorded process exit
- `build/printfins-poc-build-resume.log`, `build/printfins-poc-build-native-export.log`

The native contour report intentionally says `full_toolpath_test: false`: the
separate CLI result establishes full toolpaths; the GUI adapter itself only
performs contour slicing. The native example is a simple tilted box; the repaired
diagonal-start cases are established by the original regression suite, not by a
new physical print or this box alone. The pad dominates this example's triangle
count; performance on large models remains unmeasured.

### Failures and corrections retained for review

- The first generated test profile lacked the Windows AppConfig newline/checksum
  footer and caused `invalid string position` before the PoC ran. The preparation
  script now writes the format required by `AppConfig.cpp`; the failed run remains
  in `build/printfins-poc-run02/`. No Bambu loader or original profile was changed.
- Local policy blocked `.ps1` execution. Direct commands succeeded without
  changing the policy; the WebView profile is isolated in each run directory.
- The generic `result.3mf` caused CLI access violation `0xC0000005`, with and
  without a loaded temporary process configuration. The same geometry as STL
  succeeded. The exact importer fault was not debugged; use `project.3mf` for
  normal Bambu use. The PoC now calls Bambu's existing native project exporter;
  that project successfully imported and sliced. No importer change was made.
- The initial baseline diagnostic combining CLI slicing and CLI 3MF export also
  crashed after writing G-code. This separate path was not repaired.
- One PowerShell `Start-Process -Wait` test did not return promptly after the
  native slice had written success. A direct Python `subprocess.run()` with a
  60-second timeout independently verified normal process exit 0 in 0.80 s.

For the independently verified CLI route, call the built executable with
`--slice 0 --datadir NEW_TEST_DATA_DIR --outputdir NEW_OUTPUT_DIR project.3mf`.
Use a bounded direct process wait. The native project supplies the test settings;
the command does not send G-code to a printer.

All earlier run directories and logs were retained. Only owned synthetic test
processes were stopped after exporting their results. Protected branch refs,
the baseline tag, `AGENTS.md`, the original PrintFins snapshot and the pre-existing
untracked `log_iotc.txt` were left unchanged. No commits, pushes or merges were made.
