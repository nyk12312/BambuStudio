"""Independently check native 3MF placement against input and a Node engine replay."""
import argparse
import json
import pathlib
import subprocess
import xml.etree.ElementTree as ET
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("result_directory", type=pathlib.Path)
args = parser.parse_args()
root = args.result_directory.resolve()
report = json.loads((root / "report.json").read_text())
assert report["ok"], report
request = json.loads((root / "request.json").read_text())
adapter = pathlib.Path(__file__).resolve().parents[2] / "resources/printfins/adapter.mjs"
replay = subprocess.run(["node", "--input-type=module", "-e",
    "import fs from 'node:fs'; const {generate}=await import(process.argv[1]); "
    "console.log(JSON.stringify(generate(JSON.parse(fs.readFileSync(process.argv[2],'utf8')))));",
    adapter.as_uri(), str(root / "request.json")], capture_output=True, text=True, check=True)
engine = json.loads(replay.stdout)
expected = list(request["positions"])
offset = [engine["offset"][k] for k in ("x", "y", "z")]
for piece in engine["pieces"]:
    for a, b in piece["ranges"]:
        expected.extend(v - offset[i % 3] for i, v in enumerate(engine["triangles"][a * 9:b * 9]))

ns = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
with zipfile.ZipFile(root / "result.3mf") as archive:
    model = ET.fromstring(archive.read("3D/3dmodel.model"))
    objects = {o.attrib["id"]: o for o in model.findall("m:resources/m:object", ns)}
    actual = []
    for item in model.findall("m:build/m:item", ns):
        obj = objects[item.attrib["objectid"]]
        matrix = list(map(float, item.attrib.get("transform", "1 0 0 0 1 0 0 0 1 0 0 0").split()))
        vertices = [[float(v.attrib[k]) for k in ("x", "y", "z")]
            for v in obj.findall("m:mesh/m:vertices/m:vertex", ns)]
        for t in obj.findall("m:mesh/m:triangles/m:triangle", ns):
            for key in ("v1", "v2", "v3"):
                p = vertices[int(t.attrib[key])]
                actual.extend(sum(matrix[axis + 3 * j] * p[j] for j in range(3)) + matrix[axis + 9]
                    for axis in range(3))
    config = ET.fromstring(archive.read("Metadata/Slic3r_PE_model.config"))
    volumes = config.findall(".//volume")
assert len(actual) == len(expected), (len(actual), len(expected))
error = max(abs(a - b) for a, b in zip(actual, expected))
assert error < 1e-4, f"Native export is displaced: max error {error} mm"
assert len(volumes) == report["total_volumes"] == report["original_volumes"] + report["added_volumes"]
assert report["fin_nonempty_slices"] > 0
assert abs(report["instance_transform_delta"]) < 1e-4
result = {"ok": True, "max_position_error_mm": error,
    "source_triangles_preserved": len(request["positions"]) // 9,
    "native_vs_node_triangles": len(actual) // 9,
    "separate_volumes": len(volumes), "fin_nonempty_slices": report["fin_nonempty_slices"]}
target = root / "placement-check.json"
with target.open("x", encoding="utf-8") as f:
    json.dump(result, f, indent=2)
print(json.dumps(result, indent=2))
