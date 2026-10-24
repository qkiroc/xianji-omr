type Dialog = (content: string) => Promise<boolean>;
let dialog: Dialog | undefined;
export function setDialog(value: Dialog) {
  dialog = value;
  return () => {
    if (dialog === value) dialog = undefined;
  };
}
export function confirmAction(content: string) {
  if (!dialog) return Promise.reject(Error("界面尚未准备完成，请稍后重试"));
  return dialog(content);
}
