# SDD ledger — plan: docs/superpowers/plans/2026-11-05-a11y-interfaces.md
- Branch feat/a11y-verification from 8180f94; contract 815f5ea, spec 2c76647.
- Track A (code) and Track B (docs) dispatched in parallel worktrees at 2c76647.
- e2e/integration: Local site "Proto Blocks" absent from sites.json; e2e cannot run without pointing PB_TEST_SITE at a client site (not done). Report it.
- Track B merged (21d3f89, placeholder f6486ae dropped). Open: syncNavState covers only .wp-block-navigation links (logo links will be `missing`); hash links in core navs get aria-current; state.mjs does not type a11yBlocking.
- fd27af2 docs: openSubmenusOnClick for label-only parents (navigation.md, header-footer.md, navigation.php comment). .claude/worktrees ignored. npm test: 4 expected skill-docs failures until Track A lands a11y.mjs/site-a11y.mjs.
- Track A merged (db52aab); docs reconciled (67fcf33); npm test 772/0. test:qa running in background. Worktrees removed.
