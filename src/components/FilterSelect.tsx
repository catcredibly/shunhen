import { useTranslation } from "react-i18next";
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { searchSelectorOptions, type SelectorOption } from "../selectorOptions";

type FilterSelectProps = {
  label: string;
  entity: "academicYear" | "subject";
  options: SelectorOption[];
  disabled?: boolean;
  title?: string;
  className?: string;
  name?: string;
  autoFocus?: boolean;
  hideMultiSelect?: boolean;
  forceMultiSelect?: boolean;
  onMultiSelectChange?: (multiple: boolean) => void;
  preventEmptySelection?: boolean;
  allAsParent?: boolean;
} & (
  | { multiple: true; value: string[]; onChange: (value: string[]) => void }
  | { multiple?: false; value: string; onChange: (value: string) => void }
);

export function FilterSelect(props: FilterSelectProps) {
  const { label, entity, value, options, disabled, title, className, name, autoFocus } = props;
  const { t } = useTranslation();
  const id = useId();
  const listId = `${id}-options`;
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [multiSelect, setMultiSelect] = useState(
    Boolean(props.forceMultiSelect || (props.multiple && props.value.length > 1)),
  );
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 360 });
  const selectedValues = props.multiple ? props.value : value ? [value as string] : [];
  const parentAll = Boolean(props.multiple && multiSelect && props.allAsParent);
  const semanticAll = props.multiple && props.value.length === 0;
  const availableValues = options.filter((option) => option.value).map((option) => option.value);
  const includedValues = parentAll && semanticAll ? availableValues : selectedValues;
  const selectedOptions = options.filter((option) => option.value && selectedValues.includes(option.value));
  const selectedNames = selectedOptions.map((option) => option.label).join(", ");
  const selected =
    parentAll && semanticAll
      ? options.find((option) => !option.value)?.label || label
      : selectedOptions.length > 2
        ? t(entity === "academicYear" ? "{{count}} Academic Years" : "{{count}} Subjects", {
            count: selectedOptions.length,
          })
        : selectedNames || options.find((option) => !option.value)?.label || label;
  const visibleOptions = searchSelectorOptions(options, query);
  const selectedIndex = Math.max(
    0,
    visibleOptions.findIndex((option) =>
      option.value ? includedValues.includes(option.value) : !selectedValues.length,
    ),
  );
  const searchLabel = t(entity === "academicYear" ? "Search Academic Years..." : "Search Subjects...");
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const toggleMultiSelect = () => {
    if (!props.multiple) return;
    if (multiSelect && props.value.length > 1) props.onChange([]);
    setMultiSelect(!multiSelect);
    props.onMultiSelectChange?.(!multiSelect);
  };
  const choose = (index: number) => {
    const option = visibleOptions[index];
    if (!option) return;
    if (
      props.multiple &&
      multiSelect &&
      props.preventEmptySelection &&
      option.value &&
      selectedValues.includes(option.value) &&
      availableValues.filter((id) => selectedValues.includes(id)).length === 1
    )
      return;
    if (props.multiple && parentAll) {
      const next = !option.value
        ? []
        : includedValues.includes(option.value)
          ? includedValues.filter((id) => id !== option.value)
          : [...includedValues, option.value];
      if (option.value && !next.some((id) => availableValues.includes(id))) return;
      props.onChange(next.length && availableValues.every((id) => next.includes(id)) ? [] : next);
    } else if (props.multiple) {
      props.onChange(
        !option.value
          ? []
          : !multiSelect
            ? [option.value]
            : props.value.includes(option.value)
              ? props.value.filter((item) => item !== option.value)
              : [...props.value, option.value],
      );
    } else props.onChange(option.value);
    if (!multiSelect) close();
    else list.current?.focus();
  };
  const reveal = () => {
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((option) => selectedValues.includes(option.value)),
      ),
    );
    setOpen(true);
  };
  useEffect(() => {
    setActive((index) => Math.max(0, Math.min(index, visibleOptions.length - 1)));
    if (disabled) setOpen(false);
  }, [visibleOptions.length, disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = button.current!.getBoundingClientRect();
      const limit = Math.min(360, window.innerHeight * 0.6);
      const below = Math.max(0, window.innerHeight - rect.bottom - 12),
        above = Math.max(0, rect.top - 12);
      const upward = below < Math.min(limit, 106 + visibleOptions.length * 38) && above > below;
      const height = Math.min(limit, upward ? above : below);
      const width = Math.max(0, Math.min(Math.max(rect.width, 260), window.innerWidth - 16));
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: upward
          ? Math.max(8, rect.top - Math.min(height, menu.current?.scrollHeight ?? height) - 4)
          : rect.bottom + 4,
        width,
        maxHeight: height,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, visibleOptions.length]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, listId]);
  return (
    <>
      {name && !props.multiple && <input type="hidden" name={name} value={props.value} />}
      <button
        ref={button}
        type="button"
        className={`analytics-filter-select ${className ?? ""}`}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={label}
        title={title ?? (selectedNames || selected)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? setOpen(false) : reveal())}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            reveal();
          }
        }}
      >
        <span>{selected}</span>
        <ChevronDown size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="dialog"
            aria-label={label}
            className="analytics-filter-menu"
            style={position}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
            onBlur={(event) => {
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
            }}
          >
            <div className="selector-menu-controls">
              {!props.hideMultiSelect && (
                <div className="selector-multiple-row">
                  <span>{t("Multi-select")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-label={t("Multi-select")}
                    aria-checked={multiSelect}
                    disabled={!props.multiple}
                    className="selector-multiple-switch"
                    onClick={toggleMultiSelect}
                  >
                    <span aria-hidden="true" />
                  </button>
                </div>
              )}
              <input
                ref={search}
                type="search"
                className="selector-search"
                aria-label={searchLabel}
                placeholder={searchLabel}
                value={query}
                aria-controls={listId}
                onChange={(event) => {
                  const next = event.target.value;
                  setQuery(next);
                  setActive(
                    next.trim()
                      ? Math.max(
                          0,
                          searchSelectorOptions(options, next).findIndex((option) => Boolean(option.value)),
                        )
                      : 0,
                  );
                }}
                onKeyDown={(event) => {
                  if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                    event.preventDefault();
                    setActive(query.trim() ? active : selectedIndex);
                    list.current?.focus();
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    choose(active);
                  }
                }}
              />
            </div>
            <div
              ref={list}
              id={listId}
              role="listbox"
              tabIndex={0}
              aria-label={label}
              aria-multiselectable={multiSelect || undefined}
              aria-activedescendant={visibleOptions.length ? `${listId}-${active}` : undefined}
              className="selector-options"
              onKeyDown={(event) => {
                if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) event.preventDefault();
                if (event.key === "ArrowDown") setActive((index) => Math.min(visibleOptions.length - 1, index + 1));
                if (event.key === "ArrowUp") setActive((index) => Math.max(0, index - 1));
                if (event.key === "Home") setActive(0);
                if (event.key === "End") setActive(Math.max(0, visibleOptions.length - 1));
                if (event.key === "Enter" || event.key === " ") choose(active);
              }}
            >
              {visibleOptions.map((option, index) => {
                const checked = option.value ? includedValues.includes(option.value) : !selectedValues.length;
                const indeterminate = parentAll && !option.value && !semanticAll;
                return (
                  <Fragment key={option.value}>
                    {option.archived && !visibleOptions[index - 1]?.archived && (
                      <div
                        className={`filter-archive-heading ${visibleOptions.slice(0, index).some((item) => item.value && !item.archived) ? "has-divider" : ""}`}
                        role="presentation"
                      >
                        {t("Archived")}
                      </div>
                    )}
                    {option.group !== undefined &&
                      (index === 0 ||
                        option.groupId !== visibleOptions[index - 1]?.groupId ||
                        option.archived !== visibleOptions[index - 1]?.archived) && (
                        <div className="filter-group-heading" role="presentation">
                          {option.group}
                        </div>
                      )}
                    <div
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={checked}
                      aria-checked={parentAll ? (indeterminate ? "mixed" : checked) : undefined}
                      className={active === index ? "active" : ""}
                      onMouseMove={() => setActive(index)}
                      onClick={() => choose(index)}
                    >
                      {multiSelect && (
                        <input
                          ref={(node) => {
                            if (node) node.indeterminate = indeterminate;
                          }}
                          className="selector-checkbox"
                          type="checkbox"
                          checked={checked}
                          readOnly
                          tabIndex={-1}
                          aria-hidden="true"
                          onMouseDown={(event) => event.preventDefault()}
                        />
                      )}
                      <span>{option.label}</span>
                    </div>
                  </Fragment>
                );
              })}
              {!visibleOptions.some((option) => option.value) && query && (
                <p className="selector-empty" role="status">
                  {t("No results found")}
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
