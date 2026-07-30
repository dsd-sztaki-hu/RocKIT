#!/usr/bin/env python3
"""Validate and execute the repository metadata LinkML-Map transformation."""

from __future__ import annotations

import argparse
import os
import tempfile
from pathlib import Path
from typing import Any

# Some LinkML dependencies initialise PyStow while importing. Keep that cache
# out of the user's home and out of the repository.
os.environ.setdefault(
    "PYSTOW_HOME",
    str(Path(tempfile.gettempdir()) / "aroma-linkml-pystow"),
)

import yaml
from linkml_map.session import Session
from linkml_map.validator import validate_spec_file


ROOT = Path(__file__).resolve().parent.parent
LINKML = ROOT / "linkml"
EXAMPLES = ROOT / "examples"
SOURCE_SCHEMA = LINKML / "canonical-metadata.schema.yaml"
TARGET_SCHEMA = LINKML / "zenodo-metadata.schema.yaml"
TRANSFORM = LINKML / "canonical-to-zenodo.transform.yaml"


def without_none(value: Any) -> Any:
    """Recursively remove values that LinkML-Map could not populate."""
    if isinstance(value, dict):
        return {
            key: without_none(child)
            for key, child in value.items()
            if child is not None
        }
    if isinstance(value, list):
        return [without_none(child) for child in value if child is not None]
    return value


def validate_specification() -> None:
    messages = validate_spec_file(
        TRANSFORM,
        source_schema=SOURCE_SCHEMA,
        target_schema=TARGET_SCHEMA,
        strict=True,
    )
    if messages:
        rendered = "\n".join(
            f"{message.severity}: {message.path}: {message.message}"
            for message in messages
        )
        raise RuntimeError(f"LinkML transformation validation failed:\n{rendered}")


def execute_example() -> dict[str, Any]:
    source = yaml.safe_load(
        (EXAMPLES / "canonical-metadata.example.yaml").read_text(encoding="utf-8")
    )
    expected = yaml.safe_load(
        (EXAMPLES / "zenodo-metadata.expected.yaml").read_text(encoding="utf-8")
    )

    session = Session()
    session.set_source_schema(SOURCE_SCHEMA)
    session.set_object_transformer(TRANSFORM)
    actual = without_none(session.transform(source))

    differences = {
        key: {"expected": expected_value, "actual": actual.get(key)}
        for key, expected_value in expected.items()
        if actual.get(key) != expected_value
    }
    if differences:
        raise AssertionError(
            "LinkML example transformation differs from expected output:\n"
            + yaml.safe_dump(differences, sort_keys=False, allow_unicode=True)
        )
    return actual


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate schemas/specification without executing the example.",
    )
    args = parser.parse_args()

    validate_specification()
    if args.validate_only:
        print("LinkML-Map specification is structurally and semantically valid.")
        return

    result = execute_example()
    print(
        "LinkML-Map validation and example transformation passed "
        f"({len(result)} populated target fields)."
    )


if __name__ == "__main__":
    main()
