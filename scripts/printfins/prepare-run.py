"""Create new, isolated PoC input/profile directories. Never edit an existing profile."""
import argparse
import json
import hashlib
import math
import pathlib
import shutil
import struct

parser = argparse.ArgumentParser()
parser.add_argument("destination", type=pathlib.Path)
parser.add_argument("--profile-template", required=True, type=pathlib.Path)
args = parser.parse_args()
root = args.destination.resolve()
if root.exists():
    raise SystemExit("Use a new destination directory")
root.mkdir(parents=True)
profile = root / "profile"
profile.mkdir()
# Copy only public system presets. No account, printer, plugin or user directories.
shutil.copytree(args.profile_template / "system", profile / "system")
original = json.JSONDecoder().raw_decode((args.profile_template / "BambuStudio.conf").read_text(encoding="utf-8"))[0]
config = {k: original[k] for k in ("header", "firstguide", "models", "filaments", "nozzle_volume_types", "presets") if k in original}
config["app"] = {"version": "02.08.02.61", "language": "en", "single_instance": "false",
    "sync_user_preset": "false", "sync_system_preset": "false", "helio_enable": "false",
    "backup_switch": "false", "show_home_page": "false", "show_daily_tips": "false",
    "associate_3mf": "false", "associate_stl": "false", "associate_step": "false",
    "curr_bed_type": "Textured PEI Plate", "privacy_version": original.get("app", {}).get("privacy_version", "")}
config["firstguide"] = {"finish": "true", "privacyuse": "false"}
body = json.dumps(config, indent=4, ensure_ascii=False, sort_keys=True)
# Match AppConfig.cpp on normalized text; the Windows reader expects a footer.
checksum = hashlib.md5(body.encode("utf-8")).hexdigest().upper()
(profile / "BambuStudio.conf").write_text(body + "\n# MD5 checksum " + checksum + "\n", encoding="utf-8")

# Watertight box tilted 35 degrees; Bambu imports and positions this actual mesh.
vertices = [(-12,-8,0),(12,-8,0),(12,8,0),(-12,8,0),(-12,-8,24),(12,-8,24),(12,8,24),(-12,8,24)]
angle = math.radians(35)
vertices = [(x*math.cos(angle)+z*math.sin(angle), y, -x*math.sin(angle)+z*math.cos(angle)) for x,y,z in vertices]
floor = min(p[2] for p in vertices)
vertices = [(x+93.25,y+118.125,z-floor) for x,y,z in vertices]
faces = []
for a,b,c,d in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(2,3,7,6),(1,2,6,5),(0,4,7,3)]:
    faces.extend([(a,b,c),(a,c,d)])
with (root / "input.stl").open("wb") as f:
    f.write(b"PrintFins PoC tilted box".ljust(80,b"\0")); f.write(struct.pack("<I",len(faces)))
    for face in faces:
        f.write(struct.pack("<12fH",0,0,0,*(v for index in face for v in vertices[index]),0))
(root / "options.json").write_text(json.dumps({"lowerFootGap":0.16,"alignLowerLayers":True}), encoding="utf-8")
print(f"Prepared {root}; output directory must be {root / 'result'} (not created yet)")
