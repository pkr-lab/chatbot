import { lazy, Suspense } from "react";

const Markdown = lazy(() => import("./Markdown").then((module) => ({ default: module.Markdown })));

export const preloadMarkdown = (): void => {
  void import("./Markdown");
};

export const LazyMarkdown = ({ text }: { text: string }) => (
  <Suspense fallback={<div className="markdown plain">{text}</div>}>
    <Markdown text={text} />
  </Suspense>
);
