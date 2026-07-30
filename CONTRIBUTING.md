# Contributing

## Project Structure

```
backend/        -- API server (Astro endpoints)
frontend/       -- Astro + React UI
scrapers/
  webtoons/     -- Manga/webtoon scrapers (TypeScript, tsx)
  novel-worker/ -- Novel scrapers
  import-worker/-- Import pipeline
  playwright-worker/ -- Playwright-based scrapers
  shared/       -- Shared types and utilities
```

## Adding a New Scraper

1. Create a file in `scrapers/webtoons/definitions/<site>/<lang>/`
2. Implement the required scraper interface (see existing sources for reference)
3. Register it in the appropriate index file
4. Run `tsc --noEmit` in `scrapers/webtoons/` to check types

## Code Conventions

- TypeScript strict mode
- No `any` -- prefer `unknown` + type guards
- Single `export default` per file for scrapers
- Avoid runtime dependencies on browser-only APIs

## PR Checklist

- [ ] `tsc --noEmit` passes
- [ ] No dead code or commented-out blocks
- [ ] Descriptive commit messages in English
