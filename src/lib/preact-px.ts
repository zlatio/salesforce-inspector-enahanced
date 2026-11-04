import { options, type VNode } from "preact";

// Preact 11 stopped appending "px" to numeric inline-style values, so `style={{ height: 40 }}` is
// silently ignored. Restore the Preact 10 behaviour once, globally, instead of auditing every call site.
const UNITLESS =
  /^(animationIterationCount|aspectRatio|columnCount|columns|fillOpacity|flex|flexGrow|flexShrink|floodOpacity|fontWeight|gridArea|gridColumn|gridColumnEnd|gridColumnStart|gridRow|gridRowEnd|gridRowStart|lineClamp|lineHeight|opacity|order|orphans|scale|stopOpacity|strokeOpacity|strokeWidth|tabSize|widows|zIndex|zoom)$/;

const prev = options.vnode;
options.vnode = (vnode: VNode) => {
  const style = typeof vnode.type === "string" ? (vnode.props as { style?: unknown }).style : null;
  if (style && typeof style === "object") {
    const s = style as Record<string, unknown>;
    for (const k in s) if (typeof s[k] === "number" && s[k] !== 0 && !UNITLESS.test(k) && !k.startsWith("--")) s[k] = s[k] + "px";
  }
  prev?.(vnode);
};
