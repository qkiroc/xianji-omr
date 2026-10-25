import { test } from "node:test";
import assert from "node:assert/strict";
import { editorShortcut, blocksEditorShortcut } from "../shared/editor-shortcuts.ts";

const event = (key, options = {}) => ({
  key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
  isComposing: false, defaultPrevented: false, repeat: false, ...options,
});
test("Windows and macOS share save, undo and both redo shortcuts", () => {
  for (const modifier of ["ctrlKey", "metaKey"]) {
    for (const [key, shiftKey, action] of [
      ["s", false, "save"], ["S", false, "save"], ["z", false, "undo"],
      ["Z", true, "redo"], ["y", false, "redo"],
    ]) assert.equal(editorShortcut(event(key, { [modifier]: true, shiftKey })), action);
  }
  for (const key of ["q", "Q", "Delete", "Backspace"]) assert.equal(editorShortcut(event(key)), "delete");
  assert.equal(editorShortcut(event("Tab")), "toggle-view");
});
test("Typing, composition, held deletion and unrelated system chords are ignored", () => {
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true },
    { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { repeat: true }])
    assert.equal(editorShortcut(event("q", options)), null);
  assert.equal(editorShortcut(event("s", { ctrlKey: true, altKey: true })), null);
  assert.equal(editorShortcut(event("s", { metaKey: true, shiftKey: true })), null);
  assert.equal(editorShortcut(event("Tab", { shiftKey: true })), null);
});
test("Hidden Ant Design portals permit shortcuts; visible overlays block them", () => {
  const previous = globalThis.document;
  const overlays = [{ getClientRects: () => [] }];
  let expanded = false;
  globalThis.document = { querySelectorAll: () => overlays, querySelector: () => expanded ? {} : null };
  try {
    assert.equal(blocksEditorShortcut(event("q")), false);
    overlays.push({ getClientRects: () => [{}] });
    assert.equal(blocksEditorShortcut(event("q")), true);
    overlays.pop();
    expanded = true;
    assert.equal(blocksEditorShortcut(event("q")), true);
    expanded = false;
    const input = { closest: selector => selector.startsWith("input") ? {} : null };
    assert.equal(blocksEditorShortcut(event("q", { target: input })), true);
    assert.equal(blocksEditorShortcut(event("s", { target: input }), true), false);
  } finally { globalThis.document = previous; }
});
