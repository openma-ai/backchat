import type { CSSProperties } from "react";
import openmaLogoMarkUrl from "@openma/common/brand/openma-logo-mark.svg";

type MarkStyle = CSSProperties & { "--openma-home-mark": string };

export function OpenmaHomeMark() {
  const style: MarkStyle = {
    "--openma-home-mark": `url("${openmaLogoMarkUrl}")`,
  };

  return <span className="openma-home-mark" style={style} aria-hidden="true" />;
}
