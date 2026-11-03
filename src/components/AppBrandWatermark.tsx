import React from "react";

/**
 * Reusable fixed centered watermark displaying the official Al Tabeer emblem.
 * Positioned in the exact center of the browser viewport with subtle opacity,
 * fixed while scrolling, and with pointer-events: none so it never interferes
 * with user interactions or readability.
 */
export default function AppBrandWatermark() {
  return (
    <div className="app-brand-watermark" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/al-tabeer-emblem.png"
        alt=""
        width={380}
        height={380}
        draggable={false}
        style={{
          width: "100%",
          height: "auto",
          objectFit: "contain",
          display: "block",
          userSelect: "none",
        }}
      />
    </div>
  );
}

