import { useEffect, useRef, useState } from "react";
import { copyText } from "../utils";
import { Icon } from "./Icon";

interface CopyButtonProps {
  text: string;
  label?: string;
  withLabel?: boolean;
  className?: string;
}

export const CopyButton = ({ text, label = "Kopieren", withLabel = false, className = "icon-button" }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onClick = async (): Promise<void> => {
    if (!(await copyText(text))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button type="button" className={className} onClick={() => void onClick()} aria-label={copied ? "Kopiert" : label} title={copied ? "Kopiert" : label}>
      <Icon name={copied ? "check" : "copy"} size={withLabel ? 15 : 16} />
      {withLabel ? <span>{copied ? "Kopiert" : label}</span> : null}
    </button>
  );
};
