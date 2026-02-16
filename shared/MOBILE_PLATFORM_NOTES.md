# Mobile App Platform Notes

## Overview

The mobile app (`mobile-app/`) uses a subset of the shared platform definitions.
While the central `shared/` directory defines 22+ platforms, the mobile app currently supports **6 platforms** (defined as `MOBILE_PLATFORMS` in `shared/platforms/types.ts`).

## Synced vs Mobile-Only Files

### Synced from `shared/` (auto-generated)

These files are copied by `scripts/sync-shared.mjs` and should **not** be edited directly in `mobile-app/src/shared/`:

| File | Description |
|------|-------------|
| `platforms/types.ts` | Platform type definitions, `MOBILE_PLATFORMS` constant |
| `platforms/definitions.ts` | Full platform definitions (domains, patterns, features) |
| `platforms/detection.ts` | URL-to-platform detection logic |
| `platforms/index.ts` | Barrel export |
| `icons/platform-icons.ts` | SVG path data for platform icons |
| `constants/index.ts` | Shared constants |

### Mobile-Only Files (NOT synced)

These files contain mobile-specific logic and are maintained independently:

| File | Description |
|------|-------------|
| `src/utils/platform-detection.ts` | Mobile-specific detection with emoji/color mapping for 20+ URL patterns |
| `src/utils/url-validation.ts` | MVP validation for 6 mobile-supported platforms only |

## Why Mobile Has Its Own Detection

The mobile app's `src/utils/platform-detection.ts` exists separately because it:

1. Maps platforms to **emoji icons** and **colors** for the mobile UI (not needed in plugin/workers)
2. Handles **mobile-specific URL patterns** (e.g., app deep links)
3. Returns a simpler result type tailored to the mobile UI

The shared `platforms/detection.ts` provides the canonical URL-to-platform mapping, while the mobile utils layer adds mobile-specific presentation.

## Adding a New Platform to Mobile

1. Add the platform ID to `MOBILE_PLATFORMS` in `shared/platforms/types.ts`
2. Add `MOBILE_PLATFORM_INFO` entry in the same file
3. Run `npm run sync:shared` to propagate changes
4. Update `mobile-app/src/utils/platform-detection.ts` with emoji/color
5. Update `mobile-app/src/utils/url-validation.ts` with URL patterns
6. Test share extension and manual URL input on both iOS and Android

## Current Mobile Platforms

| Platform | ID | Status |
|----------|----|--------|
| Instagram | `instagram` | Supported |
| X/Twitter | `x` | Supported |
| Facebook | `facebook` | Supported |
| Reddit | `reddit` | Supported |
| Threads | `threads` | Supported |
| LinkedIn | `linkedin` | Supported |
