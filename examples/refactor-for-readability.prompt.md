---
description: 'Refactor the selected code for readability without changing behavior.'
mode: 'agent'
model: GPT-4o
tools: ['codebase', 'githubRepo']
argument-hint: '<file or selection>'
---
Refactor the provided code for readability: extract clearly-named helper
functions, remove dead code, and improve naming. Do not change observable
behavior. Explain each non-trivial change in a short comment or summary.
