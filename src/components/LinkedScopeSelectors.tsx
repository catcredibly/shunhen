import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AcademicYear, Subject } from "../types";
import { academicYearOptions, subjectOptions } from "../selectorOptions";
import { changeSubjectScope, changeYearScope, subjectSelection, type LinkedScope } from "../linkedScope";
import { Row } from "./SettingsControls";
import { FilterSelect } from "./FilterSelect";

/** Eligibility is supplied by the caller; linking and selector interaction are shared. */
export function LinkedScopeSelectors({
  years,
  subjects,
  value,
  onChange,
  multiOnly = false,
  disabled = false,
  emptyYears,
  emptySubjects,
  showLabels = true,
  variant = "filter",
  requireNonEmptyScope = false,
  selectedSubjectIds,
}: {
  years: AcademicYear[];
  subjects: Subject[];
  value: LinkedScope;
  onChange: (scope: LinkedScope, change?: "year" | "subject") => void;
  requireNonEmptyScope?: boolean;
  selectedSubjectIds?: string[];
  showLabels?: boolean;
  variant?: "filter" | "settings";
  multiOnly?: boolean;
  disabled?: boolean;
  emptyYears?: string;
  emptySubjects?: string;
}) {
  const { t } = useTranslation();
  const [subjectMulti, setSubjectMulti] = useState(multiOnly);
  const available = subjectOptions(years, subjects, value.yearIds);
  const yearLabel = t(variant === "settings" ? "Academic Years" : "Academic Year");
  const subjectLabel = t(variant === "settings" ? "Subjects" : "Subject");
  const wrap = (label: string, control: React.ReactNode, hint?: string) =>
    variant === "settings" ? (
      <Row label={label} hint={hint}>
        {control}
      </Row>
    ) : (
      <label>
        {showLabels && label}
        {control}
        {hint && <small className="muted">{hint}</small>}
      </label>
    );
  return (
    <>
      {wrap(
        yearLabel,
        <FilterSelect
          multiple
          entity="academicYear"
          label={yearLabel}
          className={variant === "settings" ? "settings-default-subject" : undefined}
          disabled={disabled || (multiOnly && !years.length)}
          forceMultiSelect={multiOnly}
          hideMultiSelect={multiOnly}
          preventEmptySelection={requireNonEmptyScope}
          value={disabled ? [] : value.yearIds}
          onChange={(ids) => {
            if (
              requireNonEmptyScope &&
              subjects.length &&
              !subjects.some((subject) => !ids.length || ids.includes(subject.academicYearId))
            )
              return;
            onChange(changeYearScope(value, ids), "year");
          }}
          options={[{ value: "", label: t("All Academic Years") }, ...academicYearOptions(years)]}
        />,
        !years.length ? emptyYears : undefined,
      )}
      {wrap(
        subjectLabel,
        <FilterSelect
          multiple
          entity="subject"
          label={subjectLabel}
          className={variant === "settings" ? "settings-default-subject" : undefined}
          disabled={disabled || (multiOnly && !available.length)}
          forceMultiSelect={multiOnly}
          hideMultiSelect={multiOnly}
          onMultiSelectChange={setSubjectMulti}
          preventEmptySelection
          allAsParent
          value={disabled ? [] : (selectedSubjectIds ?? subjectSelection(value, subjects))}
          onChange={(ids) => onChange(changeSubjectScope(value, ids, subjects, subjectMulti), "subject")}
          options={[{ value: "", label: t("All Subjects") }, ...available]}
        />,
        !available.length ? emptySubjects : undefined,
      )}
    </>
  );
}
