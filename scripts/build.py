"""Builds prototype/index.html from src/ and content/.

Two jobs, in the order the spec requires (§1.3.1):
1. Static validation of the content model: dangling references, actions
   outside the closed set, unknown placements, orphan fragments, EN/DE
   parity (an explicit de: "pending" passes; a silently missing de fails).
2. Assembly: the model JSON is injected byte-identical into the HTML, so
   the prototype and the reviewed content file can never drift apart.

Run from anywhere: paths resolve relative to this file.
"""
import json
import pathlib
import re

repo = pathlib.Path(__file__).resolve().parent.parent
shell = (repo / "src" / "shell.html").read_text(encoding="utf-8")
engine = (
    (repo / "src" / "engine_core.js").read_text(encoding="utf-8")
    + "\n"
    + (repo / "src" / "engine_ui.js").read_text(encoding="utf-8")
)
model_text = (repo / "content" / "builder_content_model.json").read_text(encoding="utf-8")

m = json.loads(model_text)  # fail loudly if the model is not valid JSON
assert "</script" not in model_text.lower(), "JSON would break the script tag"
assert "</script" not in engine.lower(), "engine would break the script tag"

# ---- static validation, spec §1.3.1 layer 1 ----
ACTIONS = set(m["meta"]["engine_contract"]["actions"])
PLACEMENTS = set(m["meta"]["engine_contract"]["placements"])
frag_ids = {f["id"] for f in m["clause_fragments"]}
adv_ids = {a["id"] for a in m["advisories"]}
q_ids = {q["id"] for q in m["questions"]}
errors = []

def check_condition(cond, where):
    if not isinstance(cond, dict):
        return
    for comb in ("all_of", "any_of"):
        for sub in cond.get(comb, []):
            check_condition(sub, where)
    if "question" in cond and cond["question"] not in q_ids:
        errors.append(f"{where}: condition references unknown question {cond['question']}")

for q in m["questions"]:
    if q.get("visible_if"):
        check_condition(q["visible_if"], q["id"])
    if not q.get("options"):
        errors.append(f"{q['id']}: no options")
    for o in q.get("options", []):
        if not o.get("effects"):
            errors.append(f"{q['id']}.{o['id']}: option without declared effects (spec drift)")
        for e in o.get("effects", []):
            if e["action"] not in ACTIONS:
                errors.append(f"{q['id']}.{o['id']}: action {e['action']} outside the closed set")
            if e["action"] == "include_fragment" and e["fragment"] not in frag_ids:
                errors.append(f"{q['id']}.{o['id']}: dangling fragment {e['fragment']}")
            if e["action"] == "show_advisory" and e["advisory"] not in adv_ids:
                errors.append(f"{q['id']}.{o['id']}: dangling advisory {e['advisory']}")
            if e["action"] == "set_param" and e["param"] not in m["parameters"]:
                errors.append(f"{q['id']}.{o['id']}: unknown parameter {e['param']}")

reachable = set()
for q in m["questions"]:
    for o in q.get("options", []):
        for e in o.get("effects", []):
            if e["action"] == "include_fragment":
                reachable.add(e["fragment"])
for f in m["clause_fragments"]:
    if f["placement"] not in PLACEMENTS:
        errors.append(f"{f['id']}: placement {f['placement']} outside vocabulary")
    if f.get("included_if"):
        check_condition(f["included_if"], f["id"])
        reachable.add(f["id"])
    if f.get("base"):
        reachable.add(f["id"])
    if f["id"] not in reachable:
        errors.append(f"{f['id']}: orphan fragment, no path includes it")
    for r in f.get("riders", []):
        check_condition(r["condition"], f"{f['id']}/{r['id']}")

def check_de_parity(node, path):
    if isinstance(node, dict):
        if "en" in node and node["en"] is not None and "de" not in node:
            errors.append(f"{path}: en text with silently missing de slot")
        for k, v in node.items():
            check_de_parity(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            check_de_parity(v, f"{path}[{i}]")

check_de_parity(m["questions"], "questions")
check_de_parity(m["clause_fragments"], "fragments")
check_de_parity(m["advisories"], "advisories")
check_de_parity(m["ui_copy"], "ui_copy")


# ---- spec §7.3 / §8 item 3: tooltip and explanation are required content per question ----
# The number-free rule is policy, not taste: help texts must survive rule and
# scale updates without silent invalidation, so amounts, article numbers and
# currency codes are banned from them (decision log, 2026-08-04).
legend = set(m["meta"]["status_legend"])
for q in m["questions"]:
    for field in ("tooltip", "explanation"):
        node = q.get(field)
        text = node.get("en") if isinstance(node, dict) else None
        if not (isinstance(text, str) and text.strip()):
            errors.append(f"{q['id']}: missing {field} EN text (spec §7.3, §8 item 3)")
            continue
        status = q.get(field + "_status", "")
        if not any(status.startswith(k) for k in legend):
            errors.append(f"{q['id']}: {field}_status missing or outside the status legend")
        if re.search(r"Article\s+\d|\d{3,}|USD|EUR|CHF|GBP", text):
            errors.append(f"{q['id']}: {field} breaks the number-free policy for help texts")

if errors:
    for e in errors:
        print("SCHEMA:", e)
    raise SystemExit(f"{len(errors)} schema errors")
print("schema validation OK (references, actions, placements, reachability, EN/DE parity, tooltip/explanation per question, number-free policy)")

out = (
    shell
    + '\n<script id="content_model" type="application/json">\n'
    + model_text
    + '\n</script>\n<script>\n'
    + engine
    + '\n</script>\n</body>\n</html>\n'
)

target = repo / "prototype" / "index.html"
target.write_text(out, encoding="utf-8")
print(f"OK prototype/index.html: {len(out):,} bytes (model v{m['meta']['version']})")
