# Security Policy

## Supported Versions

Currently supported versions for security updates:

| Version | Component | Supported |
| ------- | --------- | --------- |
| 1.x     | Backend   | :white_check_mark: |
| 1.x     | Scrapers  | :white_check_mark: |
| 1.x     | Worker    | :white_check_mark: |
| 0.x     | Frontend  | :warning: (Best effort) |

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please **do not open a public issue**. Instead, please report it privately through one of the following methods:

1.  **Email**: Send an email to [koussemonaurel@gmail.com](mailto:koussemonaurel@gmail.com).
2.  **GitHub Private Vulnerability Reporting**: Use the "Report a vulnerability" button in the Security tab of the repository (if enabled).

### What to expect

- **Acknowledgement**: You will receive an acknowledgement of your report within 48 hours.
- **Triage**: We will investigate the issue and determine its impact and severity.
- **Fix**: We aim to provide a fix or mitigation as soon as possible, depending on the complexity of the issue.
- **Disclosure**: Once a fix is applied and verified, we will discuss with you the appropriate timing and method for public disclosure.

### Confidentiality

We ask that you keep information about the vulnerability confidential until we have had a chance to fix it. This helps protect the users of this project.

## Security Best Practices

This project follows a proactive security approach:
- We use automated tools to scan for hardcoded secrets and vulnerable dependencies.
- We perform regular updates to core libraries.
- We adhere to the principle of least privilege for cloud service integrations (Cloudflare, Render, GCP).
