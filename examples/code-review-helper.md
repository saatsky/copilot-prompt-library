---
name: code-review-helper
title: Code Review Helper
description: Reviews a diff or PR for correctness, security, and style issues, and summarizes findings by severity.
tags:
  - review
  - quality
  - security
skills:
  - security-review
  - code-reviewer
agent: code-review
status: active
version: 1.1.0
---
Review the attached diff. For each issue found:

1. State the file and line.
2. Classify severity: critical, high, medium, or low.
3. Explain the risk in one sentence.
4. Suggest a concrete fix.

Summarize with a short table of issues by severity at the end. Do not rewrite
unrelated code, and do not invent issues that aren't actually present.
