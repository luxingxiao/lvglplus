# Figma export plugin

In Figma Desktop: Plugins → Development → Import plugin from manifest; select this directory's `manifest.json`. If Figma requires a registered plugin ID, create a new development plugin and replace the development `id` with the ID Figma assigns; see the [official manifest guide](https://developers.figma.com/docs/plugins/manifest/). Select a Frame/Component and run **LVGL Plus Export**. No account service or network is used by the plugin.

Export JSON, then:

```sh
lvglplus import-figma lvglplus-figma.json --out generated-design
lvglplus dev generated-design
```

Text, frames, groups, rectangles and basic auto layout become independent Plus XML. Vector/image/rotated content is rasterized by Figma's PNG export. Font sizes snap to available built-in fonts; arbitrary Figma effects, typography and constraints are not lossless. Review exported warnings and the actual LVGL output. For Unicode, convert/register a suitable licensed font.

Optional Plugin Data keys `lvglplus.signal` and `lvglplus.command` become model bindings and click command declarations; signal annotations require text/button nodes. Device commands still require an application handler.

`design.lock.json` owns generated files. Reimport checks their hashes, refuses edited generated files and unowned filename collisions, and preserves untracked extensions. Put custom application files in `extensions/`. Arbitrary hand edits are not merged automatically.

Implementation references: [showUI](https://developers.figma.com/docs/plugins/api/properties/figma-showui/), [exportAsync](https://developers.figma.com/docs/plugins/api/properties/nodes-exportasync/). The importer has automated tests; the plugin host must additionally be tested in the installed Figma version before a release claims Figma acceptance.
