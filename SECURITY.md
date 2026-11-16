# Security Policy

## Reporting

Do not open a public issue containing credentials, private logs, customer data, internal addresses, or exploitable production details. Report a minimal synthetic reproduction to the repository owner through the platform's private security reporting channel when available.

## Security Boundaries

- The Kit is not a secret manager.
- Text scanning is defense in depth, not a complete secret detector.
- `--fast`, `--deep`, `--release`, and `--role` are read-only.
- `--write` changes only the configured `CONTEXT-RESUME.md`.
- No command automatically deploys, publishes, spends money, mutates production data, or trusts an external receipt without evidence.

## Supported Versions

Security fixes target the latest released minor version.
