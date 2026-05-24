#!/usr/bin/env python3
"""Generate a 'Save to RWL.shortcut' file with the iOS capture token baked in.

Reads CAPTURE_TOKEN_IOS from apps/api/.env.local, builds the Shortcuts plist,
signs it with `shortcuts sign --mode anyone`, and writes the signed file next
to this script. Re-runnable.
"""

from __future__ import annotations

import os
import plistlib
import re
import subprocess
import sys
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_ROOT / "apps" / "api" / ".env.local"
OUT_DIR = REPO_ROOT / "ios"
UNSIGNED = OUT_DIR / "Save to RWL.unsigned.shortcut"
SIGNED = OUT_DIR / "Save to RWL.shortcut"

OBJECT_REPLACEMENT = "￼"  # placeholder rune that token-attachments reference


def read_token() -> str:
    if not ENV_FILE.exists():
        sys.exit(f"missing {ENV_FILE} — run `vercel env pull .env.local` in apps/api")
    for line in ENV_FILE.read_text().splitlines():
        m = re.match(r'^CAPTURE_TOKEN_IOS\s*=\s*"?([^"\n]+)"?\s*$', line)
        if m:
            return m.group(1).strip()
    sys.exit("CAPTURE_TOKEN_IOS not found in .env.local")


def text(s: str) -> dict:
    """Plain string field (no magic variables)."""
    return {
        "Value": {"string": s, "attachmentsByRange": {}},
        "WFSerializationType": "WFTextTokenString",
    }


def magic_var(output_name: str, output_uuid: str) -> dict:
    """String-typed field whose value is the output of a previous action."""
    return {
        "Value": {
            "string": OBJECT_REPLACEMENT,
            "attachmentsByRange": {
                "{0, 1}": {
                    "OutputName": output_name,
                    "OutputUUID": output_uuid,
                    "Type": "ActionOutput",
                }
            },
        },
        "WFSerializationType": "WFTextTokenString",
    }


def shortcut_input_string() -> dict:
    """String-typed field that resolves to the share-sheet input.

    Safari / app share sheets hand us the URL via Shortcut Input; in a text
    context Shortcuts coerces it to the canonical URL string.
    """
    return {
        "Value": {
            "string": OBJECT_REPLACEMENT,
            "attachmentsByRange": {
                "{0, 1}": {"Type": "ExtensionInput"},
            },
        },
        "WFSerializationType": "WFTextTokenString",
    }


def dict_field(items: list[dict]) -> dict:
    return {
        "Value": {"WFDictionaryFieldValueItems": items},
        "WFSerializationType": "WFDictionaryFieldValue",
    }


def dict_item(key: str, value: dict) -> dict:
    return {"WFItemType": 0, "WFKey": text(key), "WFValue": value}


def build_plist(token: str) -> bytes:
    uuid_ask = str(uuid.uuid4()).upper()
    uuid_geturl = str(uuid.uuid4()).upper()

    uuid_notify = str(uuid.uuid4()).upper()

    actions = [
        # 1. Ask for Input (Text) — optional "why" note
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.ask",
            "WFWorkflowActionParameters": {
                "UUID": uuid_ask,
                "WFAskActionPrompt": "Why this caught your eye? (optional)",
                "WFInputType": "Text",
                "WFAskActionDefaultAnswer": "",
                "WFAllowsEmptyAnswer": True,
            },
        },
        # 3. Get Contents of URL (POST JSON)
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "UUID": uuid_geturl,
                "WFURL": "https://rwl-api.vercel.app/api/capture",
                "WFHTTPMethod": "POST",
                "ShowHeaders": True,
                "WFHTTPHeaders": dict_field([
                    dict_item("Authorization", text(f"Bearer {token}")),
                    dict_item("Content-Type", text("application/json")),
                ]),
                "WFHTTPBodyType": "JSON",
                "WFJSONValues": dict_field([
                    dict_item("url", shortcut_input_string()),
                    dict_item("note", magic_var("Provided Input", uuid_ask)),
                    dict_item("source", text("ios-shortcut")),
                ]),
            },
        },
        # 4. Show Notification (so we see the API response on the phone)
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.notification",
            "WFWorkflowActionParameters": {
                "UUID": uuid_notify,
                "WFNotificationActionTitle": "RWL",
                "WFNotificationActionBody": magic_var("Contents of URL", uuid_geturl),
                "WFNotificationActionSound": True,
            },
        },
    ]

    workflow = {
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": "1170.1",
        "WFWorkflowClientRelease": "2.2.2",
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 4292311040,
            "WFWorkflowIconGlyphNumber": 59511,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": [
            "WFURLContentItem",
            "WFSafariWebPageContentItem",
            "WFStringContentItem",
        ],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": ["ActionExtension"],
        "WFQuickActionSurfaces": [],
        "WFWorkflowHasShortcutInputVariables": False,
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowName": "Save to RWL",
    }
    return plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY)


def main() -> None:
    token = read_token()
    if len(token) < 32:
        sys.exit(f"token looks too short ({len(token)} chars)")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    UNSIGNED.write_bytes(build_plist(token))
    print(f"wrote {UNSIGNED.name} ({UNSIGNED.stat().st_size} bytes)")

    # Sign so macOS Shortcuts will open it cleanly.
    if SIGNED.exists():
        SIGNED.unlink()
    res = subprocess.run(
        [
            "/usr/bin/shortcuts",
            "sign",
            "--mode", "anyone",
            "--input", str(UNSIGNED),
            "--output", str(SIGNED),
        ],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        sys.stderr.write(res.stdout)
        sys.stderr.write(res.stderr)
        sys.exit(f"shortcuts sign failed (exit {res.returncode})")
    print(f"wrote {SIGNED.name} ({SIGNED.stat().st_size} bytes) — signed for anyone")
    # Keep the unsigned intermediate for inspection / debugging.


if __name__ == "__main__":
    main()
