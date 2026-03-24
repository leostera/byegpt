# Tests Agent Guide

## Scope

This directory contains Python tests. JavaScript smoke tests live under `tests-js/`.

## Editing rules

- Keep tests fast enough for local pre-commit use.
- Prefer smoke tests that validate packaging contracts, exported filenames, and manifest structure.
- When a bug affects export shape or crawl behavior, add the smallest regression test that covers it.
