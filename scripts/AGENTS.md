# Scripts Agent Guide

## Scope

This directory contains helper scripts for store assets, release checksums, and other repo automation.

## Editing rules

- Scripts should be deterministic and runnable in CI without interactive input.
- Prefer Python standard library only unless a dependency is truly necessary.
- Build orchestration belongs in the JavaScript toolchain where possible. Keep this directory focused on the small leftover helpers around that toolchain.
- If a script writes generated assets, keep the output locations documented in `README.md`.
