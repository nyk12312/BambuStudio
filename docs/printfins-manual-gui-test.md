# Isolated PrintFins GUI review (Phase 1.5)

Use `feature/printfins-engine-poc`. Review the native Bambu `project.3mf`, not the
generic diagnostic `result.3mf`. The following commands create a new scratch
profile and a copy of the project. They do not start the engine, modify the
template profile, or connect to a printer. Do not reuse your normal profile as
`--datadir`.

## Start the existing geometry

Paste this block into PowerShell. No script execution-policy change is needed.
Keep the scratch directory for your screenshots and any saved test projects.

```powershell
Set-Location 'C:\3D-Dev\BambuStudio-PrintFins'
if ((git branch --show-current) -ne 'feature/printfins-engine-poc') { throw 'Wrong branch' }
$run = Join-Path $PWD ('build\printfins-gui-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
python scripts/printfins/prepare-run.py $run --profile-template 'C:\3D-Dev\BambuStudio-TestProfile'
if ($LASTEXITCODE -ne 0) { throw 'Profile preparation failed' }
Copy-Item -LiteralPath 'build\printfins-poc-run04\result\project.3mf' -Destination (Join-Path $run 'review.3mf') -ErrorAction Stop
$names = @('BBS_PRINTFINS_POC_ENABLE', 'BBS_PRINTFINS_POC_OUTPUT', 'BBS_PRINTFINS_POC_ASSETS', 'BBS_PRINTFINS_POC_OPTIONS', 'BBS_PRINTFINS_POC_AUTOCLOSE', 'WEBVIEW2_USER_DATA_FOLDER')
$saved = @{}
try {
    foreach ($name in $names) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $run 'webview-profile'
    Start-Process -FilePath (Join-Path $PWD 'build\src\Release\bambu-studio.exe') -WorkingDirectory $run -WindowStyle Normal -ArgumentList ('--datadir "{0}\profile" "{0}\review.3mf"' -f $run)
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
Write-Host "Test directory: $run"
```

`prepare-run.py` copies only public system presets and whitelisted configuration
keys. Account data, printer connections, plugins, user presets and recent
projects are omitted. Studio may update its new scratch profile during normal
use; the template remains separate. The PoC has no printer-command path. No
network plugin is copied; this is not a claim that the entire Studio application
has no general network activity.

## Manual checks

1. No PrintFins dialog or new `result` directory should appear. This launch opens
   existing geometry with the generator disabled.
2. Open the **Objects** tab in **Prepare** and expand `input.stl`. Expect three
   normal printable parts: `input.stl`, `PrintFins PoC prop 0`, and
   `PrintFins PoC pad pad`. These are parts of one object, not three independent
   objects or Bambu support modifiers. Select each added part to highlight it.
   Maximize the window if the tree is too short, or scroll inside the tree.
3. Orbit and zoom without moving/scaling the model. Check the fin meets the
   sloping underside and the pad sits on the bed. The sample has one fin with
   four tines; the pad is a separate part.
4. Click **Slice plate** (or **Ctrl+R**) and inspect **Preview**. Scrub from the
   first layer through the contact region. The pad, fin walls and model should
   produce toolpaths without an import/slice error. All three parts use ordinary
   model toolpaths; Bambu need not label them as "Support". Depending on profile,
   the application may show normal support/overhang advice for the tilted box.
   If the dual-extruder tutorial is offered, choose **No**. A **Parameter
   recommendation** window can be closed with **X**; no suggested setting needs
   to be enabled for this test.
5. Record a screenshot of the expanded tree and the relevant preview layers.
   If saving, save only inside the new test directory. Close without printing;
   **Print plate**, **Send** and device controls are outside this test.

Expected numerical reference from run04: 43,120 total triangles, 3 normal parts,
0 instance-transform shift, maximum independently checked vertex discrepancy
0.0000010338 mm. CLI slicing of the native project succeeded with 0.16 mm regular
and 0.20 mm first layers. Visual agreement is an additional check, not a physical
print validation. Engine upper-gap/pad defaults still use PLA while the saved
test preset is PETG; this project is not a material-qualified print job.

## Explicitly regenerate (optional)

For an engine test, prepare a different fresh directory with `prepare-run.py`.
In the same `try/finally` environment block above, additionally set:

```powershell
$env:BBS_PRINTFINS_POC_ENABLE = '1'
$env:BBS_PRINTFINS_POC_OUTPUT = Join-Path $run 'result'
$env:BBS_PRINTFINS_POC_ASSETS = Join-Path $PWD 'resources\printfins'
$env:BBS_PRINTFINS_POC_OPTIONS = Join-Path $run 'options.json'
$env:BBS_PRINTFINS_POC_AUTOCLOSE = '1'
```

Start `input.stl` instead of `review.3mf`. The active `--datadir` must be exactly
that run's `profile` directory and `result` must not already exist. The explicit
enable flag alone, or an inherited output variable alone, does not suffice. The
test adds parts to the scratch model in memory and writes only new exports.
The app remains open after the computation dialog closes.

## Unresolved generic 3MF import crash

`build/printfins-poc-run03/result/result.3mf` from `store_3mf()` caused CLI exit
`-1073741819` (`0xC0000005`), both with and without an explicitly loaded temporary
process configuration. The same geometry imported/sliced as STL. A separate
baseline diagnostic combining CLI slicing and generic 3MF export also crashed
after writing G-code. A debugger stack and minimal importer reproducer are still
missing; malformed metadata, importer behavior or another cause have not been
established. Do not call this a proven upstream bug.

The existing `Plater::export_3mf()` native project route successfully imported and
sliced. No working exporter or importer was refactored for Phase 1.5. Retain the
failed artifacts/logs for later diagnosis; the manual test uses only the native
project copy.

## Actual Phase 1.5 results (2026-10-16)

The startup hook in `GUI_App.cpp` still schedules the small helper; the helper
returns before any model/profile work unless explicitly enabled. The guard is
in `src/slic3r/GUI/PrintFinsPoC.cpp`; `scripts/printfins/run-poc.ps1` now sets the
new enable flag. The engine and both export paths were left unchanged.

| Check | Observed result |
|---|---|
| Release x64 build | Exit 0, 27.34 s for final incremental link; existing LNK4098 warning |
| Disabled generator with an output variable present | Native project opened; no PoC output directory/dialog |
| Enabled generator with mismatched scratch profile | Refused before creating output; explicit log message |
| Enabled generator with matching scratch profile | `report.json`: ok, 3 parts, 43,108 added triangles, instance shift 0 |
| Independent new-run placement check | Passed; all 12 source triangles preserved; maximum error 0.0000010338 mm |
| Actual GUI object tree | All 3 normal parts visible separately in maximized Objects tree |
| Actual GUI Slice plate | Succeeded; Preview displayed 208 layers, maximum Z 33.32 mm, estimated 46m37s |
| Lower-layer visual checks | Toolpaths inspected at layers 7 (1.16 mm) and 79 (12.68 mm), plus full-height preview; no obvious placement displacement |
| Profile/project safety | Original native project, template config, AGENTS.md and pre-existing log hashes unchanged; review copy also unchanged |
| Scratch network data | No copied network-plugin files or nonempty credential keys in the scratch config |
| Git review | No binaries, meshes, G-code, screenshots or generated profiles among untracked candidates; outputs remain ignored under build/ |

Evidence retained in `build/printfins-phase15-gui01/`:
`objects-maximized.png`, `preview-after-guides.png`, `preview-lower.png` (layer 79),
and `preview-first-layer.png` (**despite the filename, the slider stopped at
layer 7**, not layer 1). Exact first-layer visual inspection remains on the
manual checklist. These images were captured only from the owned test window.
Screenshots show the model, fin/pad placement and toolpaths; they do not measure
the contact gap or establish physical print quality.

Fresh generator evidence is in `build/printfins-phase15-engine01/result/`:
`report.json`, `placement-check.json`, and the new native `project.3mf`. The
negative profile test is recorded in that run's first Studio log. The existing
run04 native project remains the stable input used by the instructions above.

The first build-launch attempt failed before compilation because of command
quoting. The corrected attempt compiled the guard but encountered LNK1104:
the earlier offline CLI test PID 25532 still held `BambuStudio.dll` even though
Windows reported it as exited. Restart Manager identified that exact owner.
The previous DLL was preserved as
`build/src/Release/BambuStudio.phase1-preserved.dll`; the normal build then
created the new DLL successfully. No dependency setting or exporter changed.
All failed build logs remain under `build/printfins-poc-build-phase15*`.

GUI tests used only scratch copies. No H2D print/send action, profile migration,
software installation, commit, push or merge was performed. The generic import
access violation remains unresolved; this phase did not attempt to fix it.
