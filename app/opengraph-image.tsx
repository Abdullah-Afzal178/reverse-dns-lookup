import { ImageResponse } from "next/og";

import { PAGE_TITLE, SITE_NAME } from "@/lib/constants";

export const alt = PAGE_TITLE;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const box = {
    display: "flex",
    flexDirection: "column" as const,
    border: "2px solid #1e3a8a",
    background: "#ffffff",
    padding: "22px 30px",
    fontFamily: "monospace",
    fontSize: "34px",
    color: "#1c1917",
  };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#fbfaf5",
          padding: "70px 76px",
          fontFamily: "serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", color: "#78716c", fontSize: "22px", letterSpacing: "0.16em", textTransform: "uppercase", fontFamily: "sans-serif" }}>
            {SITE_NAME}
          </div>
          <div style={{ display: "flex", marginTop: "18px", color: "#1e3a8a", fontSize: "70px", lineHeight: 1.08 }}>
            Who is behind this address, and can you trust the answer?
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "26px" }}>
          <div style={box}>66.249.66.1</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", fontSize: "24px", color: "#1e3a8a", fontFamily: "sans-serif" }}>
            <div style={{ display: "flex" }}>PTR →</div>
            <div style={{ display: "flex", color: "#047857" }}>← A confirmed</div>
          </div>
          <div style={{ ...box, background: "#fef08a" }}>crawl-66-249-66-1.googlebot.com</div>
        </div>
      </div>
    ),
    size,
  );
}
