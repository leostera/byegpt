# Scripts Agent Guide

## Scope

This directory contains helper scripts for packaging, asset generation, and other repo automation.

## Editing rules

- Scripts should be deterministic and runnable in CI without interactive input.
- Prefer Python standard library only unless a dependency is truly necessary.
- Packaging scripts must produce stable filenames and stable archive contents.
- If a script writes generated assets, keep the output locations documented in `README.md`.
