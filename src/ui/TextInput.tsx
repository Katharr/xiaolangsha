import { useState } from "react";

export type TextInputProps = {
  /** 是否轮到真人自由输入（发言/拉票/遗言/复盘追问）。 */
  enabled: boolean;
  /** 正在处理动作时禁用，防重复提交。 */
  busy: boolean;
  placeholder: string;
  maxLength: number;
  submitLabel: string;
  /** 去空格后为空时的提示文案。 */
  emptyHint: string;
  /** 返回 true 表示提交成功→清空草稿；false 保留草稿供修改重试。 */
  onSubmit: (text: string) => Promise<boolean>;
};

/**
 * 自由文本输入区：仅在轮到真人时启用。纯文本，带长度上限与即时校验。
 * 提交中禁用，成功清空、失败保留草稿（phase-5.5 文本规则）。
 */
export function TextInput({
  enabled,
  busy,
  placeholder,
  maxLength,
  submitLabel,
  emptyHint,
  onSubmit,
}: TextInputProps) {
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState("");

  const trimmed = draft.trim();
  const overLimit = draft.length > maxLength;
  const canSubmit = enabled && !busy && trimmed.length > 0 && !overLimit;

  const handleSubmit = async () => {
    if (trimmed.length === 0) {
      setHint(emptyHint);
      return;
    }
    if (overLimit) {
      setHint(`不能超过 ${maxLength} 字。`);
      return;
    }
    setHint("");
    const ok = await onSubmit(trimmed);
    if (ok) {
      setDraft("");
    }
  };

  return (
    <div className="text-input" aria-label="输入区">
      <textarea
        className="text-input-field"
        value={draft}
        disabled={!enabled || busy}
        maxLength={maxLength + 50}
        placeholder={enabled ? placeholder : "当前无需输入，请等待或使用上方操作。"}
        onChange={(event) => {
          setDraft(event.target.value);
          if (hint) {
            setHint("");
          }
        }}
      />
      <div className="text-input-footer">
        <span className={overLimit ? "char-count over" : "char-count"}>
          {draft.length}/{maxLength}
        </span>
        {hint ? <span className="text-input-hint">{hint}</span> : null}
        <button type="button" disabled={!canSubmit} onClick={handleSubmit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
