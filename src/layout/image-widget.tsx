/** @jsx jsx */
import { jsx } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { ImageWidgetConfig } from "./types";
import { safeLinkUrl } from "../utils";
import { flexStyle } from "./flex-styles";

export const ImageWidget: FC<{ node: ImageWidgetConfig }> = ({ node }) => {
  const containerStyle = [
    flexStyle(node.flex),
    node.max_height ? `max-height:${node.max_height}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  const objectFit = node.object_fit ?? "contain";
  const alt = node.alt ?? "";

  const img = (
    <img
      src={node.image}
      alt={alt}
      style={`object-fit:${objectFit}; max-width:100%; max-height:100%;`}
      loading="lazy"
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
