# @kothar/extension-api

The public types for writing a Kothar extension: `Extension`, `ExtensionHost`, the settings, panels and tools an
extension declares, and the common event stream every engine's adapter speaks (`EngineEvent`). Types only, with no
runtime code, and MIT licensed ([LICENSE](LICENSE)) so your extension can use any licence.

Every built-in extension in [`extensions/`](../../extensions/README.md) is written against this file alone, and so is
every community extension.

## Using it

It isn't published to npm yet. Community extensions copy [`index.ts`](index.ts) into their own repo; the template
[kothar-sample-mod](https://github.com/billwang7599/kothar-sample-mod) does that for you. Inside this repo, import it as
`@kothar/extension-api` (it's an npm workspace).

```ts
import type { Extension } from '@kothar/extension-api'

const hello: Extension = {
  id: 'hello',
  name: 'Hello',
  description: 'Says hello.',
  enabledByDefault: true,
  // settings, tools, panels, event handlers…
}

export default hello
```

The [extension documentation](../../extension-documentation/index.md) has a quick start, the anatomy of an extension
and the full reference.

## Changing it

The API changes only in small, generic steps, each in its own PR with the core change behind it, and
[`extension-documentation/reference/`](../../extension-documentation/reference/) updated to match. See
[Writing an extension](../../CONTRIBUTING.md#writing-an-extension).
