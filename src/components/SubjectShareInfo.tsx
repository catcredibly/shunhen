import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ValueTooltip } from "./ValueTooltip";

export function SubjectShareInfo() {
  const { t } = useTranslation();
  const description = t("Periods without study data are omitted.");
  return (
    <ValueTooltip lines={[description]}>
      <Info size={14} className="subject-share-info" aria-label={description} />
    </ValueTooltip>
  );
}
