# Non-Chat Return Navigation Browser Smoke

Run against a local QA preview server with an isolated data directory:

```sh
npm test
npm run typecheck
npm run build
DATA_DIR=/private/tmp/gitdex-qa-164-dev-data ./node_modules/.bin/next dev -H 127.0.0.1 -p 8104
```

Use the preview URL assigned to the QA run if it differs from `http://127.0.0.1:8104`.

## Settings From Project Chat

1. Visit a seeded project chat page, for example `/projects/<projectId>`.
2. Click the left-bottom Settings icon.
3. Confirm the browser navigates to `/projects/<projectId>?panel=settings`.
4. Click the active Settings icon again.
5. Confirm the browser returns to `/projects/<projectId>`.
6. Open settings again and click the in-page Back to workspace control.
7. Confirm the browser returns to `/projects/<projectId>`.

## Tools Return

1. Visit `/projects/<projectId>`.
2. Open Tools from the project workspace Settings panel.
3. Click the in-page Back control.
4. Confirm the browser returns to the prior project chat page.

## Unsaved Settings Confirmation

1. Visit `/projects/<projectId>?panel=settings`.
2. Change a writable settings field without saving.
3. Click either the active Settings icon or the in-page Back to workspace control.
4. Cancel the browser confirmation.
5. Confirm the browser stays on the settings page and the changed value remains visible.
6. Click the same return control again and accept the browser confirmation.
7. Confirm the browser returns to `/projects/<projectId>`.
