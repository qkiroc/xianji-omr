"use client";
import React, {
  Children,
  isValidElement,
  type ReactNode,
  useState,
} from "react";
import {
  Button as AntButton,
  Input as AntInput,
  InputNumber,
  Select as AntSelect,
  Checkbox,
  Slider,
  Upload,
  Modal,
  Form as AntForm,
  Table as AntTable,
  App,
  Collapse,
  Tooltip,
} from "antd";

// Keep event-based domain handlers independent of the presentation library.
export function Button({
  type,
  className,
  color: _color,
  title,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const button = (
    <AntButton
      {...props}
      className={className}
      htmlType={type || "submit"}
      type={className?.includes("primary") ? "primary" : "default"}
      danger={className?.includes("danger")}
    />
  );
  return title ? <Tooltip title={title}>{button}</Tooltip> : button;
}
const change = (value: unknown, name?: string) => ({
  target: { value, name },
  currentTarget: { value, name },
});
export function Input({
  type,
  onChange,
  value,
  defaultValue,
  size: _size,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  if (type === "checkbox")
    return (
      <Checkbox
        {...(props as React.ComponentProps<typeof Checkbox>)}
        onChange={onChange as React.ComponentProps<typeof Checkbox>["onChange"]}
      />
    );
  if (type === "file")
    return (
      <Upload
        fileList={[]}
        accept={props.accept}
        multiple={props.multiple}
        disabled={props.disabled}
        showUploadList={false}
        beforeUpload={(_, list) => {
          if (_ === list[0]) {
            const files = list.map((f) => f as File);
            onChange?.({
              target: { files, value: "" },
              currentTarget: { files, value: "" },
            } as unknown as React.ChangeEvent<HTMLInputElement>);
          }
          return false;
        }}
      >
        <AntButton disabled={props.disabled} aria-label={props["aria-label"]}>
          选择文件
        </AntButton>
      </Upload>
    );
  if (type === "range")
    return (
      <Slider
        aria-label={props["aria-label"]}
        min={Number(props.min)}
        max={Number(props.max)}
        step={Number(props.step || 1)}
        value={value === undefined ? undefined : Number(value)}
        defaultValue={
          defaultValue === undefined ? undefined : Number(defaultValue)
        }
        onChange={(v) =>
          onChange?.(
            change(
              String(v),
              props.name,
            ) as React.ChangeEvent<HTMLInputElement>,
          )
        }
      />
    );
  if (type === "number")
    return (
      <InputNumber
        {...(props as React.ComponentProps<typeof InputNumber>)}
        value={value === undefined ? undefined : value === "" ? null : Number(value)}
        defaultValue={
          defaultValue === undefined || defaultValue === "" ? undefined : Number(defaultValue)
        }
        onChange={(v) =>
          onChange?.(
            change(
              v === null ? "" : String(v),
              props.name,
            ) as React.ChangeEvent<HTMLInputElement>,
          )
        }
      />
    );
  const Component = type === "password" ? AntInput.Password : AntInput;
  return (
    <Component
      {...props}
      type={type}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
    />
  );
}
export const Textarea = AntInput.TextArea;
export function Select({
  children,
  value,
  defaultValue,
  onChange,
  name,
  id,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((child) => {
      const p = (
        child as React.ReactElement<
          React.OptionHTMLAttributes<HTMLOptionElement>
        >
      ).props;
      return {
        value: String(p.value ?? p.children ?? ""),
        label: p.style ? <span style={p.style}>{p.children}</span> : p.children,
        disabled: p.disabled,
      };
    });
  const [inner, setInner] = useState(
    String(defaultValue ?? options[0]?.value ?? ""),
  );
  const current = String(
    value ??
      (options.some((option) => option.value === inner)
        ? inner
        : (options[0]?.value ?? "")),
  );
  return (
    <>
      <AntSelect
        {...(props as React.ComponentProps<typeof AntSelect>)}
        id={id ? id + "-control" : undefined}
        value={current}
        options={options}
        onChange={(v) => {
          setInner(String(v));
          onChange?.(
            change(String(v), name) as React.ChangeEvent<HTMLSelectElement>,
          );
        }}
      />
      <input type="hidden" id={id} name={name} value={current} />
    </>
  );
}
export function Form({
  onSubmit,
  action,
  method,
  children,
  ...props
}: React.FormHTMLAttributes<HTMLFormElement>) {
  const { notification } = App.useApp();
  return (
    <AntForm
      noValidate
      {...(props as React.ComponentProps<typeof AntForm>)}
      action={action}
      method={method}
      onSubmitCapture={(e) => {
        if (!e.currentTarget.checkValidity()) {
          e.preventDefault();
          e.stopPropagation();
          notification.error({
            title: "请检查输入",
            description: "请填写所有必填项，并检查输入格式和数值范围。",
          });
          return;
        }
        if (onSubmit) onSubmit(e);
        else if (action) {
          e.preventDefault();
          const form = e.currentTarget;
          const button = (e.nativeEvent as SubmitEvent)
            .submitter as HTMLButtonElement | null;
          if (button?.name) {
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = button.name;
            input.value = button.value;
            form.append(input);
          }
          HTMLFormElement.prototype.submit.call(form);
        }
      }}
    >
      {children}
    </AntForm>
  );
}
export function Dialog({ children }: { children: ReactNode }) {
  const child = Children.toArray(children)[0];
  const content = isValidElement<{ children: ReactNode }>(child)
    ? Children.toArray(child.props.children)
    : [];
  const heading = content.find((c) => isValidElement(c) && c.type === "h2");
  const body = isValidElement<{ children: ReactNode }>(child)
    ? React.cloneElement(
        child,
        {},
        content.filter((c) => c !== heading),
      )
    : children;
  return (
    <Modal
      open
      footer={null}
      closable={false}
      maskClosable={false}
      width={720}
      rootClassName="omr-dialog"
      title={
        isValidElement<{ children: ReactNode }>(heading)
          ? heading.props.children
          : undefined
      }
    >
      {body}
    </Modal>
  );
}
export const TableHead = ({ children }: { children: ReactNode }) => (
  <>{children}</>
);
export const TableBody = ({ children }: { children: ReactNode }) => (
  <>{children}</>
);
export const TableRow = ({
  children,
}: React.HTMLAttributes<HTMLTableRowElement>) => <>{children}</>;
export const TableCell = ({
  children,
}: React.TdHTMLAttributes<HTMLTableCellElement>) => <>{children}</>;
export const TableHeading = TableCell;
type ElementProps = {
  children?: ReactNode;
  onClick?: React.MouseEventHandler;
  className?: string;
  colSpan?: number;
};
const elements = (children: ReactNode) =>
  Children.toArray(children).filter(
    isValidElement,
  ) as React.ReactElement<ElementProps>[];
export function Table({ children }: { children: ReactNode }) {
  const parts = elements(children),
    head = parts.find((c) => c.type === TableHead),
    body = parts.find((c) => c.type === TableBody);
  const headings = elements(elements(head?.props.children)[0]?.props.children);
  const rows = elements(body?.props.children),
    empty = rows.find((r) => elements(r.props.children)[0]?.props.colSpan);
  const data = rows
    .filter((r) => !elements(r.props.children)[0]?.props.colSpan)
    .map((row, index) => ({
      key: row.key ?? index,
      row,
      cells: elements(row.props.children),
    }));
  return (
    <AntTable
      pagination={false}
      size="middle"
      dataSource={data}
      locale={{ emptyText: empty?.props.children }}
      onRow={(r) => ({
        onClick: r.row.props.onClick,
        className: r.row.props.className,
      })}
      columns={headings.map((h, i) => ({
        key: i,
        title: h.props.children,
        render: (_, r) => (
          <span onClick={r.cells[i]?.props.onClick}>
            {r.cells[i]?.props.children}
          </span>
        ),
      }))}
    />
  );
}

export const Summary = TableHead;
export function Details({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const parts = elements(children),
    summary = parts.find((c) => c.type === Summary);
  return (
    <Collapse
      className={className}
      ghost
      size="small"
      items={[
        {
          key: "advanced",
          label: summary?.props.children,
          children: parts.filter((c) => c !== summary),
        },
      ]}
    />
  );
}
