# Scripts Agent Guide

## Scope

This directory contains helper scripts for release checksums and other repo automation.

## Editing rules

- Scripts should be deterministic and runnable in CI without interactive input.
- Build orchestration belongs in the JavaScript toolchain where possible. Keep this directory focused on the small leftover helpers around that toolchain.
