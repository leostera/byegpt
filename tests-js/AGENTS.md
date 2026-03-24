# JavaScript Tests Agent Guide

## Scope

This directory contains fast smoke tests for the extension repository.

## Editing rules

- Keep tests fast enough for pre-commit execution.
- Prefer contract-level checks over brittle UI simulations.
- Cover packaging and publication guarantees first:
  - manifest shape
  - generated assets
  - required docs and static pages
