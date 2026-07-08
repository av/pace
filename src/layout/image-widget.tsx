import type { FC } from "hono/jsx";
import type { ImageWidgetConfig } from "./types";
import { safeLinkUrl } from "../utils";
import { flexStyle } from "./flex-styles";
import { isSafeEmbedUrl } from "../config-validate";

export const ImageWidget: FC<{ node: ImageWidgetConfig }> = ({ node }) => {
  const containerStyle = [
    flexStyle(node.flex),
    node.max_height ? `max-height:${node.max_height}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  const objectFit = node.object_fit ?? "contain";
  // Whitespace-only alt ("   ") is as meaningless to assistive tech as an empty
  // one, but would otherwise dodge the decorative handling below (no aria-hidden,
  // and a linked image would get no aria-label fallback) — normalize it to "".
  const rawAlt = node.alt ?? "";
  const alt = rawAlt.trim() ? rawAlt : "";

  // Decorative images (empty alt) get aria-hidden so assistive tech skips them entirely
  const isDecorative = !alt;

  // cover/fill need the element to fill its container so object-fit can crop/stretch;
  // contain/none only need max constraints so the image never overflows.
  const fillsContainer = objectFit === "cover" || objectFit === "fill";
  const sizeStyle = fillsContainer
    ? "width:100%; height:100%;"
    : "max-width:100%; max-height:100%;";

  // Render-time guard mirroring config validation: programmatic AppConfig can
  // bypass validateSafeUrl, so never emit an img src with a disallowed scheme
  // (javascript:, data:, ...).
  const safeSrc = isSafeEmbedUrl(node.image) ? node.image : null;
  if (safeSrc === null) {
    console.warn(`layout: image src blocked (disallowed scheme or invalid URL): ${node.image}`);
    return (
      <div class="flex-panel" style={containerStyle}>
        <div class="image-widget" />
      </div>
    );
  }

  const img = (
    <img
      src={safeSrc}
      alt={alt}
      style={`object-fit:${objectFit}; ${sizeStyle}`}
      loading="lazy"
      {...(isDecorative && !node.link ? { "aria-hidden": "true" } : {})}
    />
  );

  const href = node.link ? safeLinkUrl(node.link) : null;
  // When alt is empty (decorative) and a link wraps the image, provide an aria-label
  // so screen readers can still announce the link destination.
  const linkLabel = href && !alt ? node.link : undefined;

  return (
    <div class="flex-panel" style={containerStyle}>
      <div class="image-widget">
        {href
          ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={linkLabel}>{img}</a>
          : img
        }
      </div>
    </div>
  );
};
