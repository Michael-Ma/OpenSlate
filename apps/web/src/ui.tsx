import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";
import type {
  ButtonHTMLAttributes,
  ComponentPropsWithoutRef,
  ReactNode,
  RefObject,
} from "react";
import {
  Button,
  Dialog,
  IconButton as RadixIconButton,
  Select,
  TextArea,
  TextField,
} from "@radix-ui/themes";

type ButtonVariant =
  | "solid"
  | "soft"
  | "outline"
  | "surface"
  | "classic"
  | "ghost";
export type UiButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "color"
> & {
  variant?: ButtonVariant | "primary" | "secondary" | "danger" | "success";
  size?: "1" | "2" | "3" | "4";
};

/** Standard actions retain native form, disabled and event behavior. */
export const UiButton = forwardRef<HTMLButtonElement, UiButtonProps>(
  function UiButton(
    { variant, size = "2", className = "", type = "button", ...props },
    ref,
  ) {
    const intent =
      variant ??
      (className.split(/\s+/).includes("primary")
        ? "primary"
        : className.split(/\s+/).includes("text-button")
          ? "ghost"
          : "secondary");
    const radixVariant: ButtonVariant =
      intent === "primary" || intent === "danger" || intent === "success"
        ? "solid"
        : intent === "secondary"
          ? "surface"
          : intent;
    return (
      <Button
        {...props}
        ref={ref}
        type={type}
        size={size}
        variant={radixVariant}
        {...(intent === "danger"
          ? { color: "red" as const }
          : intent === "success"
            ? { color: "green" as const }
            : {})}
        className={`ui-button ${className}`}
      />
    );
  },
);

export const UiTextField = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<typeof TextField.Root>, "size" | "variant">
>(function UiTextField({ className = "", ...props }, ref) {
  return (
    <TextField.Root
      {...props}
      ref={ref}
      size="2"
      variant="surface"
      className={`ui-text-field ${className}`}
    />
  );
});

export const UiTextArea = forwardRef<
  HTMLTextAreaElement,
  Omit<ComponentPropsWithoutRef<typeof TextArea>, "size" | "variant">
>(function UiTextArea({ className = "", ...props }, ref) {
  return (
    <TextArea
      {...props}
      ref={ref}
      size="2"
      variant="surface"
      className={`ui-text-area ${className}`}
    />
  );
});

export type UiSelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};
export type UiSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly UiSelectOption[];
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
};

/** Radix emits a value rather than fabricating a native ChangeEvent. */
export const UiSelect = forwardRef<HTMLButtonElement, UiSelectProps>(
  function UiSelect(
    {
      value,
      onValueChange,
      options,
      id,
      name,
      disabled,
      required,
      placeholder,
      className = "",
      ...accessibility
    },
    ref,
  ) {
    // An empty native option is represented internally because Radix reserves "" for a placeholder.
    let emptyValue = "__openslate_empty_select_option__";
    while (options.some((option) => option.value === emptyValue))
      emptyValue += "_";
    const hasEmptyOption = options.some((option) => option.value === "");
    return (
      <>
        <Select.Root
          value={value === "" && hasEmptyOption ? emptyValue : value}
          onValueChange={(next) =>
            onValueChange(next === emptyValue ? "" : next)
          }
          {...(!hasEmptyOption && name !== undefined ? { name } : {})}
          {...(disabled !== undefined ? { disabled } : {})}
          {...(required !== undefined ? { required } : {})}
          size="2"
        >
          <Select.Trigger
            {...accessibility}
            ref={ref}
            {...(id !== undefined ? { id } : {})}
            variant="surface"
            {...(placeholder !== undefined ? { placeholder } : {})}
            className={`ui-select ${className}`}
          />
          <Select.Content position="popper" className="ui-select-menu">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value === "" ? emptyValue : option.value}
                {...(option.disabled !== undefined
                  ? { disabled: option.disabled }
                  : {})}
              >
                {option.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        {hasEmptyOption && name && (
          <input type="hidden" name={name} value={value} disabled={disabled} />
        )}
      </>
    );
  },
);

export const ConversationSurface = createContext(false);
export const ConversationToolBusy = createContext<
  ((id: string, busy: boolean) => void) | null
>(null);

export type AppDialogProps = {
  inline?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Supplementary heading content, such as the project name. The semantic title is always rendered. */
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  closeLabel?: string;
  closeDisabled?: boolean;
  preventClose?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  size?: "1" | "2" | "3" | "4";
  maxWidth?: string;
};

/** Shared modal layout, dismissal rules and focus restoration for controlled app dialogs. */
export function AppDialog({
  inline: inlineOverride,
  open,
  onOpenChange,
  title,
  description,
  children,
  header,
  footer,
  className = "",
  headerClassName = "",
  bodyClassName = "",
  footerClassName = "",
  closeLabel = "Close dialog",
  closeDisabled = false,
  preventClose = false,
  initialFocusRef,
  returnFocusRef,
  size = "3",
  maxWidth = "760px",
}: AppDialogProps) {
  const returnFocus = useRef<HTMLElement | null>(null),
    content = useRef<HTMLDivElement>(null),
    descriptionId = useId();
  const registerBusy = useContext(ConversationToolBusy);
  const conversationSurface = useContext(ConversationSurface);
  const inline = inlineOverride ?? conversationSurface;
  useEffect(() => {
    if (!inline || !open || !registerBusy) return;
    registerBusy(descriptionId, preventClose || closeDisabled);
    return () => registerBusy(descriptionId, false);
  }, [inline, open, registerBusy, descriptionId, preventClose, closeDisabled]);
  useEffect(() => {
    if (!inline || !open) return;
    const launcher = document.activeElement;
    if (launcher instanceof HTMLElement && !content.current?.contains(launcher))
      returnFocus.current = launcher;
    content.current?.scrollIntoView({ block: "start" });
    (initialFocusRef?.current ?? content.current)?.focus({
      preventScroll: true,
    });
    return () => {
      const target = returnFocusRef?.current ?? returnFocus.current;
      if (target?.isConnected && !target.matches(":disabled"))
        target.focus({ preventScroll: true });
    };
  }, [inline, open]);
  if (inline)
    return !open ? null : (
      <div
        ref={content}
        tabIndex={-1}
        role="region"
        aria-labelledby={`${descriptionId}-title`}
        className={`app-dialog conversation-tool ${className}`}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !preventClose && !closeDisabled) {
            event.stopPropagation();
            onOpenChange(false);
          }
        }}
      >
        <header className={`app-dialog-header ${headerClassName}`}>
          <div className="app-dialog-heading">
            {header}
            <h3 id={`${descriptionId}-title`} className="app-dialog-title">
              {title}
            </h3>
            {description && (
              <p className="app-dialog-description">{description}</p>
            )}
          </div>
          <UiButton
            variant="ghost"
            disabled={preventClose || closeDisabled}
            aria-label={closeLabel}
            onClick={() => onOpenChange(false)}
          >
            ×
          </UiButton>
        </header>
        <div className={`app-dialog-body ${bodyClassName}`}>{children}</div>
        {footer && (
          <footer className={`app-dialog-footer ${footerClassName}`}>
            {footer}
          </footer>
        )}
      </div>
    );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next || !preventClose) onOpenChange(next);
      }}
    >
      <Dialog.Content
        ref={content}
        size={size}
        maxWidth={maxWidth}
        className={`app-dialog ${className}`}
        aria-describedby={description ? descriptionId : undefined}
        onOpenAutoFocus={(event) => {
          // StrictMode replays focus effects; never replace the launcher with a dialog child.
          const active = document.activeElement;
          if (
            active instanceof HTMLElement &&
            !content.current?.contains(active)
          )
            returnFocus.current = active;
          if (initialFocusRef?.current) {
            event.preventDefault();
            initialFocusRef.current.focus({ preventScroll: true });
          }
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current ?? returnFocus.current;
          if (target?.isConnected && !target.matches(":disabled")) {
            event.preventDefault();
            target.focus({ preventScroll: true });
          }
        }}
        onEscapeKeyDown={(event) => {
          if (preventClose) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (preventClose) event.preventDefault();
        }}
      >
        <header className={`app-dialog-header ${headerClassName}`}>
          <div className="app-dialog-heading">
            {header}
            <Dialog.Title className="app-dialog-title">{title}</Dialog.Title>
            {description && (
              <Dialog.Description
                id={descriptionId}
                className="app-dialog-description"
              >
                {description}
              </Dialog.Description>
            )}
          </div>
          <RadixIconButton
            type="button"
            variant="ghost"
            color="gray"
            size="2"
            disabled={closeDisabled || preventClose}
            onClick={() => onOpenChange(false)}
            aria-label={closeLabel}
            title={closeLabel}
            className="app-dialog-close icon-button"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </RadixIconButton>
        </header>
        <div className={`app-dialog-body ${bodyClassName}`}>{children}</div>
        {footer && (
          <footer className={`app-dialog-footer ${footerClassName}`}>
            {footer}
          </footer>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
