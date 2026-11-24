import { useState } from "react";

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
}

export const PasswordField = ({ label, value, onChange, autoComplete, autoFocus }: PasswordFieldProps) => {
  const [visible, setVisible] = useState(false);
  return (
    <label>
      <span>{label}</span>
      <span className="password-box">
        <input
          type={visible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          maxLength={128}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" className="text-button" onClick={() => setVisible((current) => !current)} aria-pressed={visible}>
          {visible ? "Verbergen" : "Zeigen"}
        </button>
      </span>
    </label>
  );
};
