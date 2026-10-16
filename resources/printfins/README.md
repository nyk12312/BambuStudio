# PrintFins engine snapshot

`vendor/` contains 44 byte-for-byte copies from the user's modified
`support-fins-main` project, including its MIT license. It is not a stock upstream
checkout. `vendor/ORIGIN.json` records every SHA256 and the public upstream commit
used for comparison. The original folder has no local Git metadata, so its exact
upstream ancestor cannot be established.

The snapshot contains the existing lower-foot-gap, fixed-layer-contact and
diagonal 45-degree-start code (`web/prop/config.js`, `lower.js`, `starts.js`,
`mold.js`, `sweep.js`). No geometry algorithms are implemented in our adapter.

The native PoC calls `adapter.mjs` in a WebView2 module worker. `generate()` calls
the snapshot's `computeFins()`. The older shared plugin entry omits the user's
lower-gap settings; the adapter applies those settings before calling it and
resets them on every request. Interface material is disabled for this PoC.

The virtual host `https://printfins-poc.invalid` serves only this local folder.
There is no HTTP server or request to printfins.com. The HTML content policy
limits scripts, workers and connections to this origin.

See `docs/printfins-engine-poc.md` for execution and limitations. Verify with:

```powershell
python scripts/printfins/check-snapshot.py
python scripts/printfins/check-snapshot.py "PATH\TO\ORIGINAL\support-fins-main"
```
