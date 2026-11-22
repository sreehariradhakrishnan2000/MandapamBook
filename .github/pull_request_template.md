## Summary

<!-- What does this PR do and why? Link the phase and any issue. -->

## Screenshots (UI changes)

<!-- Mobile and desktop where relevant. -->

## Test evidence

<!-- Commands run and results: lint, typecheck, unit, integration, e2e. -->

## Migration notes

<!-- New/changed migrations, data backfills, rollback steps. "None" if not applicable. -->

## Security considerations

<!-- AuthZ changes, new inputs, secrets, PII, crypto, CI/security config changes (must be called out). -->

## New dependencies

| Package | Why | Alternatives considered |
| ------- | --- | ----------------------- |

## Checklist

- [ ] Branch follows `feat|fix|chore|docs/<scope>-<desc>` and targets `develop`
- [ ] Commits follow Conventional Commits
- [ ] Lint, typecheck and tests pass locally and in CI
- [ ] Secret scan clean; no `.env`, keys, dumps or real customer data
- [ ] Every new input is validated with Zod; every new route has a permission and ownership check
- [ ] Money handled as integer paise
- [ ] Docs updated (README, docs/, SECURITY.md as needed)
- [ ] CI workflows, CODEOWNERS or security config changes are called out above
