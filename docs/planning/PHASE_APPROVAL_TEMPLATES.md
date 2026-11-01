# Exact approval phrases

The owner must explicitly authorise each phase. Feature approvals and reviews never count as implementation approval.

## First build authorisation (only when ready)
`AUTHORISE PHASE 0. Use the GitHub repository [INSERT APPROVED PRIVATE REPO URL OR NEW PRIVATE REPO NAME]. Complete Phase 0 only, run the acceptance tests, commit and push that stage, report the full SHA and stop. Do not start Phase 1.`

Do not send this until you are ready. If repo access is not available, request a safe plan for connecting it before any push.

## Following stages (only after checking preceding stage report)
`AUTHORISE PHASE 1. Build only Phase 1 of the Studio Bars master plan, run all acceptance tests, update HANDOVER.md, commit and push the tested stage to the approved private GitHub repository, then STOP.`

Replace PHASE 1 with PHASE 1B, 2, 3, 4, 5, 6, 7 or 8 as appropriate. Phase 8 and collaboration require explicit separate approval. Never use the phrase "build everything" unless that is genuinely intended; one-stage policy remains preferred.

## Report gate
After any stage, require a report showing exactly what changed, tests that ran and passed/failed, outstanding risks, branch, commit SHA, verified push, and what you personally need to check.
