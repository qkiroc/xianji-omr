export type EditorShortcut = "save" | "delete" | "undo" | "redo" | "toggle-view";

// Ctrl on Windows/Linux and Command on macOS use the same actions.
export function editorShortcut(event: KeyboardEvent): EditorShortcut | null {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return null;
  const key = event.key.toLowerCase();
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey) {
    if (key === "s" && !event.shiftKey) return "save";
    if (key === "z") return event.shiftKey ? "redo" : "undo";
    if (key === "y" && !event.shiftKey) return "redo";
    return null;
  }
  if (key === "tab" && !event.shiftKey) return "toggle-view";
  if (!event.repeat && ["q", "delete", "backspace"].includes(key)) return "delete";
  return null;
}

export function blocksEditorShortcut(event: KeyboardEvent, allowTextInput = false): boolean {
  const target = event.target as Element | null;
  if (target?.closest?.('[inert], [role="dialog"], dialog[open]')) return true;
  // Ant Design leaves portal roots mounted after closing a dialog or menu.
  if ([...document.querySelectorAll(".ant-modal-wrap, dialog[open], .ant-dropdown")]
      .some((overlay) => overlay.getClientRects().length > 0)) return true;
  if (document.querySelector('.ant-select [aria-expanded="true"], .ant-select[aria-expanded="true"]')) return true;
  return !allowTextInput && !!target?.closest?.(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .ant-select, .ant-input-number',
  );
}
