import { Children, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./CopyButton";

const textOf = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
};

const CodeBlock = ({ children }: { children?: ReactNode }) => {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return <pre>{children}</pre>;
  const className = child.props.className ?? "";
  const language = /language-([\w+#-]+)/.exec(className)?.[1] ?? "";
  const code = textOf(child.props.children).replace(/\n$/, "");
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{language || "Text"}</span>
        <CopyButton text={code} withLabel className="text-button" />
      </div>
      <pre>
        <code className={className}>{child.props.children}</code>
      </pre>
    </div>
  );
};

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  ),
};

const rehypePlugins = [[rehypeHighlight, { detect: false, ignoreMissing: true }]] as never;

export const Markdown = memo(({ text }: { text: string }) => (
  <div className="markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
      {text}
    </ReactMarkdown>
  </div>
));

Markdown.displayName = "Markdown";
