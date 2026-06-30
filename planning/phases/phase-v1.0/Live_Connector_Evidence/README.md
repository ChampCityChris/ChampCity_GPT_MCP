# Live ChatGPT Connector Evidence

This folder contains the safe evidence format for operator-assisted live ChatGPT connector validation.

Use the template in this folder for live validation notes:

```powershell
npm run chatgpt:evidence:validate -- --template
npm run chatgpt:evidence:validate -- --template --json
npm run chatgpt:evidence:validate -- --file planning/phases/phase-v1.0/Live_Connector_Evidence/<evidence-file>.md
npm run chatgpt:evidence:validate -- --dir planning/phases/phase-v1.0/Live_Connector_Evidence
```

Live evidence must be captured manually by the operator or from explicit ChatGPT tool results. This workflow does not use browser automation, ChatGPT UI scraping, screenshots, OAuth/DCR changes, Cloudflare changes, packaging, release publication, or token capture.

Local deterministic checks such as `npm run mcp:self-test` support release validation, but they do not prove live ChatGPT connector behavior.

Do not store actual live evidence here if it contains secrets, raw public tunnel URLs, private local paths, OAuth material, local config contents, logs with secrets, or release binary contents. Use `%USERPROFILE%`, `%TEMP%`, `<REDACTED_LOCAL_PATH>`, `<REDACTED_PUBLIC_ENDPOINT>`, and `<REDACTED_SECRET>` instead.
