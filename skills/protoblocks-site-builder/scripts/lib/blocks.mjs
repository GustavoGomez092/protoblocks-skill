export function serializeAttrs(attrs) {
  if (!attrs || !Object.keys(attrs).length) return '';
  return JSON.stringify(attrs)
    .replace(/--/g, '\\u002d\\u002d')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\\"/g, '\\u0022');
}

export function blockComment(name, attrs = {}, innerMarkup) {
  const a = serializeAttrs(attrs);
  const open = `<!-- wp:${name}${a ? ` ${a}` : ''}`;
  if (innerMarkup === undefined) return `${open} /-->`;
  return `${open} -->\n${innerMarkup}\n<!-- /wp:${name} -->`;
}
