# block.json Schema (`protoBlocks`)

A Proto-Blocks block is a standard WordPress `block.json` plus a `protoBlocks` key. Standard WP keys (`name`, `title`, `category`, `icon`, `keywords`, `supports`, `apiVersion`, etc.) behave as in core. This document covers the `protoBlocks` extension and how the schema is read, defaulted, and validated.

## Full `protoBlocks` structure

```json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "proto-blocks/my-block",
  "title": "My Block",
  "category": "proto-blocks",
  "icon": "admin-post",
  "supports": { "html": false, "anchor": true, "align": ["wide", "full"] },

  "protoBlocks": {
    "version": "1.0",
    "template": "template.php",
    "useTailwind": false,
    "isExample": false,

    "fields": {
      "fieldName": {
        "type": "text",
        "tagName": "h3",
        "default": "",
        "className": "",
        "required": false,
        "maxLength": 100
      }
    },

    "controls": {
      "controlName": {
        "type": "select",
        "label": "Display Label",
        "default": "a",
        "options": [{ "key": "a", "label": "A" }],
        "min": 0, "max": 100, "step": 1,
        "help": "Helper text",
        "conditions": { "visible": { "otherControl": "value" } },
        "affects": ["fieldName"]
      }
    }
  }
}
```

## `protoBlocks` keys

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `version` | string | `"1.0"` | Schema version. Any string accepted; not version-checked. |
| `template` | string | `"{blockName}.php"` | Template filename, resolved relative to the block dir. Conventionally `template.php`. |
| `useTailwind` | bool | `false` | Enable Tailwind compilation/scoping for this block. See `styling.md`. |
| `isExample` | bool | `false` | Marks a bundled example block. |
| `fields` | object | `{}` | Editable content regions. See `fields.md`. |
| `controls` | object | `{}` | Inspector sidebar settings. See `controls.md`. |

Auto-added by the schema reader (internal, do not set by hand): `templatePath`, `blockDir`, `previewImage` (auto-detected `preview.png`/`.jpg`/`.jpeg`/`.webp`).

## Defaults applied when reading the schema

The SchemaReader fills in missing values:

- `name` → `proto-blocks/{folder-name}` if absent.
- `title` → title-cased from the name if absent.
- `category` → `proto-blocks` if absent.
- `apiVersion` → `3` if absent.
- A field given as a bare string (`"heading": "text"`) is normalized to `{ "type": "text" }`. Fields default to `type: "text"`.
- A control with no `label` gets one auto-generated from its name (`ucwords` over `_`/`-`). Controls default to `type: "text"`.
- Select `options` accept either `[{ "key", "label" }]` or a `{ "key": "label" }` map — both normalize to the `{ key, label }` array form.

## Validation: errors vs warnings

The SchemaValidator distinguishes hard errors from non-blocking warnings.

**Errors (block is invalid / throws):**
- Block `name` is missing.
- A `select` or `multiselect` control has no `options`.

**Warnings (logged, block still loads):**
- Block `name` not in `namespace/block-name` format.
- Unknown field type (custom types are allowed — warning only).
- Unknown control type (custom types allowed).
- Field name not matching `^[a-zA-Z_][a-zA-Z0-9_]*$`.
- `range` control missing `min` or `max`.
- Unknown `conditions` key (only `visible` and `enabled` are recognized).
- Template file not found.
- Unknown `supports` option.

Validate from the CLI: `wp proto-blocks validate [<name>] [--format=table|json]`.

## How fields & controls become block attributes

Both fields and controls are compiled into WordPress block attributes (readable as `$attributes['name']` in the template, and editable in the editor):

- **Fields** produce an attribute typed from the field type (string/object/array) with internal metadata `__protoType` and `__protoConfig`.
- **Controls** produce an attribute typed from the control's data type, flagged with `__protoControl` and `__protoControlConfig`.
- If a field and control share a name, the field wins (control is skipped).

Type mapping: `string→string`, `number|integer|float→number`, `boolean|bool→boolean`, `array→array`, `object→object`, anything else → `string`.

**Core WordPress attributes** are also generated from `supports`, so the template can read them:

| `supports` entry | Attributes added |
|------------------|------------------|
| `align` / `alignWide` | `align` |
| `anchor` | `anchor` |
| `customClassName` | `className` |
| `color.text` | `textColor` |
| `color.background` | `backgroundColor` |
| `color.gradient` | `gradient` |
| `typography.fontSize` | `fontSize` |
| `typography.fontFamily` | `fontFamily` |
| always | `style` (object), `innerBlocksContent` (string) |

## Field config options (common)

| Option | Applies to | Meaning |
|--------|-----------|---------|
| `type` | all | Field type string (see `fields.md`). |
| `tagName` | text, wysiwyg, link | HTML tag rendered/expected (`h3`, `p`, `a`, ...). |
| `default` | all | Initial value. |
| `className` | all | Extra class. |
| `required` | all | Marks field required for validation. |
| `maxLength` | text, wysiwyg | Max character count (wysiwyg counts stripped text). |
| `fields` | repeater | Sub-field definitions (required for repeaters). |
| `min` / `max` / `itemLabel` / `collapsible` | repeater | See `repeaters.md`. |
| `sizes` / `defaultSize` | image | Available image sizes. |
| `allowedBlocks` / `template` / `templateLock` / `orientation` / `renderAppender` | inner-blocks | See `fields.md`. |
