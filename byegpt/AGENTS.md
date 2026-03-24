# Python CLI Agent Guide

## Scope

This package contains the Python CLI and normalization utilities for supported OpenAI export surfaces.

## Editing rules

- Keep output formats explicit and deterministic.
- Preserve backward-compatible manifest fields where practical.
- Prefer small pure functions with straightforward file I/O boundaries.
- Add or update unit tests whenever you change exported file layouts or parsing logic.
